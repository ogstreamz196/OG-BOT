// Parses OG Sports Guide Telegram listings ("DAZN CA 01: Italy vs. Türkiye 10-05 19:45 GMT",
// "EPL01: Liverpool 14:00 Brighton 25/10")
// into structured fixtures, and searches them line by line.

export type Fixture = { channel: string; event: string; at: Date | null; raw: string };
export type Listing = {
  id: string;
  title: string;
  date: string | null;
  fixtures: Fixture[];
  notes: string[];
  postedAt: string;
  messageId: number;
};

// "DAZN CA 01: Italy vs. Türkiye 10-05 19:45 GMT"
const LINE = /^(.+?\s?\d{1,3})\s*:\s*(.+?)(?:\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*GMT)?\s*$/i;
// "EPL01: Liverpool 14:00 Brighton 25/10" and "EFL01: (L2) Walsall 20:00 Salford 26/10":
// kick-off between the teams, UK time.
const UK_LINE =
  /^([A-Za-z][A-Za-z+ ]*?\s?\d{1,3})\s*:\s*(?:\(([^)]+)\)\s*)?(.+?)\s+(\d{1,2})[:.](\d{2})\s+(.+?)\s+(\d{1,2})\/(\d{1,2})\s*$/;
const TITLE = /^(.*?)\s+(\d{2}\.\d{2}\.\d{4})\s*$/;

export function cleanText(t: string) {
  return t.replace(/\n?•\s*Sent via TeleFeed\s*$/i, "").trim();
}

/** The fixture's year: the post's, unless the month is half a year away (New Year). */
function yearFor(month: number, posted: Date): number {
  const y = posted.getUTCFullYear();
  const diff = month - (posted.getUTCMonth() + 1);
  return diff > 6 ? y - 1 : diff < -6 ? y + 1 : y;
}

/** UK wall-clock time to the real instant (GMT in winter, BST in summer). */
function ukInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const ukHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(guess)),
  );
  return new Date(guess - ((ukHour - h + 24) % 24) * 3_600_000);
}

/** "Rei do Rio (Rei do Rio)" reads as "Rei do Rio". */
function tidyEvent(event: string): string {
  const m = event.match(/^(.*?)\s*\(([^()]+)\)$/);
  return m && m[1].toLowerCase().endsWith(m[2].trim().toLowerCase()) ? m[1] : event;
}

function parseFixture(line: string, posted: Date): Fixture | null {
  const m = line.match(LINE);
  if (m && m[3]) {
    const month = Number(m[3]);
    const at = new Date(
      Date.UTC(yearFor(month, posted), month - 1, Number(m[4]), Number(m[5]), Number(m[6])),
    );
    return { channel: m[1].trim(), event: tidyEvent(m[2].trim()), at, raw: line };
  }
  const uk = line.match(UK_LINE);
  if (uk) {
    const [, channel, league, home, h, mi, away, d, mo] = uk;
    const month = Number(mo);
    const at = ukInstant(yearFor(month, posted), month, Number(d), Number(h), Number(mi));
    const event = `${league ? `${league.trim()}: ` : ""}${home.trim()} vs ${away.trim()}`;
    return { channel: channel.trim(), event, at, raw: line };
  }
  return null;
}

export function parseListing(p: {
  id: string;
  raw_text: string;
  posted_at: string;
  telegram_message_id: number;
}): Listing {
  const lines = cleanText(p.raw_text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const posted = new Date(p.posted_at);
  const first = lines[0] ?? "";
  const tm = first.match(TITLE);
  const fixtures: Fixture[] = [];
  const notes: string[] = [];
  for (const line of lines.slice(tm ? 1 : 0)) {
    const f = parseFixture(line, posted);
    if (f) fixtures.push(f);
    else notes.push(line);
  }
  // Untitled: a "⚽ EPL Events ⚽" heading, or a long listing carried on in a
  // second post, named after its channel ("FloSports 311" → "FloSports").
  const headed = !tm && fixtures.length > 0 && notes[0] === first;
  const title = tm
    ? tm[1].trim()
    : headed
      ? first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      : fixtures.length
        ? fixtures[0].channel.replace(/\s*\d+$/, "")
        : "";
  return {
    id: p.id,
    title,
    date: tm ? tm[2] : null,
    fixtures,
    notes: headed ? notes.slice(1) : notes,
    postedAt: p.posted_at,
    messageId: p.telegram_message_id,
  };
}

/** Drop duplicate posts (same text re-posted). */
export function dedupe<T extends { raw_text: string }>(posts: T[]): T[] {
  const seen = new Set<string>();
  return posts.filter((p) => {
    const k = cleanText(p.raw_text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Returns listing narrowed to matching fixtures, or null when nothing matches. */
export function searchListing(l: Listing, words: string[]): Listing | null {
  if (!words.length) return l;
  const title = l.title.toLowerCase();
  const hit = (s: string) => words.every((w) => (title + " " + s).toLowerCase().includes(w));
  const fixtures = l.fixtures.filter((f) => hit(f.raw));
  const notes = l.notes.filter(hit);
  if (!fixtures.length && !notes.length) return null;
  return { ...l, fixtures, notes };
}
