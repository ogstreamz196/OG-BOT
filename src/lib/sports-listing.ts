// Parses OG Sports Guide Telegram listings ("DAZN CA 01: Italy vs. Türkiye 10-05 19:45 GMT")
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

const LINE = /^(.+?\s?\d{1,3})\s*:\s*(.+?)(?:\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*GMT)?\s*$/i;
const TITLE = /^(.*?)\s+(\d{2}\.\d{2}\.\d{4})\s*$/;

export function cleanText(t: string) {
  return t.replace(/\n?•\s*Sent via TeleFeed\s*$/i, "").trim();
}

export function parseListing(
  p: { id: string; raw_text: string; posted_at: string; telegram_message_id: number },
): Listing {
  const lines = cleanText(p.raw_text).split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const tm = first.match(TITLE);
  const year = tm ? Number(tm[2].slice(6)) : new Date(p.posted_at).getUTCFullYear();
  const fixtures: Fixture[] = [];
  const notes: string[] = [];
  for (const line of lines.slice(tm ? 1 : 0)) {
    const m = line.match(LINE);
    if (m && m[3]) {
      const at = new Date(Date.UTC(year, Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6])));
      fixtures.push({ channel: m[1].trim(), event: m[2].trim(), at, raw: line });
    } else notes.push(line);
  }
  return {
    id: p.id,
    title: tm ? tm[1].trim() : fixtures.length ? first : "",
    date: tm ? tm[2] : null,
    fixtures,
    notes: tm || !fixtures.length ? notes : notes.slice(1),
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
