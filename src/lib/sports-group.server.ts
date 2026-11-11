// The OG Sports Guide group (the Boss, 2026-11-03): OG B0T reads the group and
// chats to it. Members (unlocked Sports Guide or VIP) are treated like royalty
// and get the fixtures; anyone not signed up gets cheeky banter and a push to
// join. It also drops the odd random comment about games coming up and games
// just gone. No AI — fixed phrase banks and the parsed guide feed, so it's free
// and nothing new is stored (reuses sports_guide_posts + site_content), which
// keeps the data easy to move off Lovable later. Light banter only, never a slur
// or real abuse. Pure helpers here; the group reply wiring is in the webhook.
import { SPORTS_GUIDE_CHAT_ID } from "./sports-guide-parse";
import { parseListing, dedupe, type Fixture } from "./sports-listing";

type Admin = any;

export const isSportsGuideChat = (chatId: number | undefined): boolean => chatId === SPORTS_GUIDE_CHAT_ID;

/**
 * A Boss/feed listing (mirror it) rather than a person chatting (answer it).
 * TeleFeed posts, or anything that parses into real fixture lines.
 */
export function looksLikeListing(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (/sent via telefeed/i.test(t)) return true;
  // A short question is never a listing (stops "which game is on?" mirroring).
  if (t.length < 60 && /\?\s*$/.test(t)) return false;
  const parsed = parseListing({ id: "x", raw_text: t, posted_at: new Date().toISOString(), telegram_message_id: 0 });
  return parsed.fixtures.length > 0;
}

const WHICH_GAME_RE =
  /\b(which|what|any|whats|what's|wheres|where's)\b[^?]*\b(game|match|fixture|fixtures|on|playing|showing|football|footy|kick[\s-]?off)\b|\bgames?\s+(on|tonight|today|this\s+\w+)\b|\bwhat'?s\s+on\b|\bwho'?s\s+playing\b|\bany\s+(games|football|footy|matches)\b|\bfixtures?\b/i;

/** "which game is on", "what's on tonight", "any footy today", "fixtures?" */
export function isWhichGameAsk(text: string | null | undefined): boolean {
  return !!text && WHICH_GAME_RE.test(text);
}

const fmtKo = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export type Split = { live: Fixture[]; upcoming: Fixture[]; finished: Fixture[] };

/** Sort the guide's fixtures into on-now, coming-up and just-gone. Pure. */
export function splitFixtures(fixtures: Fixture[], now = Date.now()): Split {
  const seen = new Set<string>();
  const uniq = fixtures.filter((f) => !seen.has(f.raw) && !!seen.add(f.raw));
  const live: Fixture[] = [];
  const upcoming: Fixture[] = [];
  const finished: Fixture[] = [];
  for (const f of uniq) {
    if (!f.at) {
      upcoming.push(f);
      continue;
    }
    const mins = (f.at.getTime() - now) / 60_000;
    if (mins <= 0 && mins > -130) live.push(f); // kicked off within ~2h = on now
    else if (mins > 0) upcoming.push(f);
    else if (mins >= -300) finished.push(f); // ended within the last 5h
  }
  const byTime = (a: Fixture, b: Fixture) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0);
  upcoming.sort(byTime);
  live.sort(byTime);
  finished.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return { live, upcoming, finished };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pick = <T,>(a: T[], rand: () => number): T => a[Math.floor(rand() * a.length) % a.length];

const ROYAL_OPENERS = [
  "Say less, your majesty 👑",
  "For you? Anything, boss 🫡",
  "The VIP treatment, as always 👑",
  "Rolling out the red carpet for a proper member 🔴",
  "A real one asked, so here you go 👑",
];

/** A member's fixtures answer: royal tone, the on-now and next-up list. Pure. */
export function memberFixturesReply(split: Split, rand: () => number = Math.random): string {
  const line = (f: Fixture) => `• ${f.at ? fmtKo(f.at) : "time TBC"} — ${esc(f.event)}\n   📺 ${esc(f.channel)}`;
  const parts: string[] = [pick(ROYAL_OPENERS, rand)];
  if (split.live.length) parts.push("\n🔴 <b>On now</b>\n" + split.live.slice(0, 6).map(line).join("\n"));
  if (split.upcoming.length) parts.push("\n⏭️ <b>Coming up</b>\n" + split.upcoming.slice(0, 8).map(line).join("\n"));
  if (!split.live.length && !split.upcoming.length)
    parts.push("\nNothing left on the card for now. I'll shout when the next one's close 👑");
  return parts.join("\n");
}

const NON_MEMBER_LOCK = [
  "Oi {name}, nice try 😅 The games list is for members only.",
  "{name}, the fixtures are behind the velvet rope, and you're not on the list 🚫",
  "Easy {name}. Paying members get the games, freeloaders get the banter 😏",
  "{name} out here wanting the full card for free 💀 Not happening, pal.",
];

/** Non-member asking for games: cheeky block + how to unlock. Pure. */
export function nonMemberLockReply(name: string | null | undefined, rand: () => number = Math.random): string {
  const who = name ? esc(name) : "mate";
  return (
    pick(NON_MEMBER_LOCK, rand).replace("{name}", who) +
    "\n\n🏆 Unlock the <b>OG Sports Guide</b> in the Store for just <b>10 OG Coins</b> — or go <b>VIP</b> and it's included free.\n" +
    "💸 Skint? Earn coins by inviting your mates with your OG code, or 5 coins is only 99p.\n" +
    "👉 Sign up, then the whole card's yours."
  );
}

const ROYAL_CHAT = [
  "There he is 👑 the man himself. What do you need, boss?",
  "A proper member speaks and I listen. Go on then 🫡",
  "You pay, you get the royal treatment. What's up? 👑",
  "Top one, {name}. Always a pleasure. 🙌",
];

/** A warm line when a member chats (not asking games). Pure. */
export function royalChatLine(name: string | null | undefined, rand: () => number = Math.random): string {
  const who = name ? esc(name) : "boss";
  return pick(ROYAL_CHAT, rand).replace("{name}", who);
}

const NON_MEMBER_JAB = [
  "Look who crawled in 😏 {name}, you still haven't signed up. The members are eating good and you're on the outside with your nose on the glass.",
  "{name} talking big for someone who won't drop 99p to join 💀 Sign up and maybe I'll take you serious.",
  "Oi {name}, members get the fixtures and the royal treatment. You get this cheeky message. Sort your life out and sign up 👇",
  "Another word out of you {name} and I'll start charging. Members only round here — join the club 😤",
];

/** A cheeky jab at a non-member who chats. Light banter, never cruel. Pure. */
export function nonMemberJabLine(name: string | null | undefined, rand: () => number = Math.random): string {
  const who = name ? esc(name) : "pal";
  return pick(NON_MEMBER_JAB, rand).replace("{name}", who);
}

/* ── Random banter about games coming up / just gone (cron) ─────────────── */

const BANTER_UPCOMING = [
  "👀 {event} is coming ({when}). Members already know where to watch. The rest of you? Good luck.",
  "⏰ {when}: {event}. I'd tell you the channel but, you know, that's a members thing 😏",
  "🔥 {event} not far off ({when}). Big one. Members are sorted, freeloaders are refreshing dodgy streams.",
  "📺 {event} {when}. Unlock the guide and you'll never miss a kickoff again.",
];
const BANTER_FINISHED = [
  "🧻 Hope none of you backed the wrong side in {event}. Brutal.",
  "😂 {event} is done. Someone in here definitely lost their shirt.",
  "That {event} result had a few of you very quiet, didn't it 💀",
];
const BANTER_GENERAL = [
  "😴 Quiet in here. Members get the full fixture list on tap — the rest of you get me being bored.",
  "Reminder: the people getting every game and kickoff time are the ones who signed up. Just saying 👑",
  "Freeloaders lurking, members eating. Same as every day in here 😏",
];

/**
 * One cheeky banter line for the cron: about the next game, a just-finished one,
 * or a general members-vs-freeloaders nudge. Pure (given `rand`).
 */
export function pickGroupBanter(split: Split, rand: () => number = Math.random): string {
  const roll = rand();
  const when = (f: Fixture) => (f.at ? fmtKo(f.at) : "soon");
  if (split.upcoming.length && roll < 0.6) {
    const f = split.upcoming[0];
    return pick(BANTER_UPCOMING, rand).replace("{event}", esc(f.event)).replace("{when}", when(f));
  }
  if (split.finished.length && roll < 0.85) {
    const f = split.finished[0];
    return pick(BANTER_FINISHED, rand).replace("{event}", esc(f.event));
  }
  return pick(BANTER_GENERAL, rand);
}

/** Load the guide's fixtures from the last few days of posts. */
async function loadFixtures(admin: Admin): Promise<Fixture[]> {
  const { data } = await admin
    .from("sports_guide_posts")
    .select("id, raw_text, posted_at, telegram_message_id")
    .gte("posted_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("posted_at", { ascending: false })
    .limit(600);
  type Row = { id: string; raw_text: string; posted_at: string; telegram_message_id: number };
  return dedupe((data ?? []) as Row[]).flatMap((p) =>
    parseListing({
      id: p.id,
      raw_text: p.raw_text,
      posted_at: p.posted_at,
      telegram_message_id: p.telegram_message_id,
    }).fixtures,
  );
}

/** The on-now + next-up + just-gone split, read live from the guide feed. */
export async function groupFixtureSplit(admin: Admin, now = Date.now()): Promise<Split> {
  return splitFixtures(await loadFixtures(admin), now);
}

/** 9am–11pm UK: when the bot is allowed to chirp in the group. Pure. */
export function daytimeUK(now = Date.now()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)),
  );
  return hour >= 9 && hour < 23;
}

const BANTER_KEY = "sports.group.banterAt";
/** At least this long between random banter posts. */
export const BANTER_EVERY_MS = 3 * 3_600_000;

/** Whether a random banter post is due. Pure. */
export function banterDue(lastIso: string | null, now: number): boolean {
  if (!daytimeUK(now)) return false;
  const t = lastIso ? Date.parse(lastIso) : NaN;
  return !Number.isFinite(t) || now - t >= BANTER_EVERY_MS;
}

/**
 * The cron hook: every few hours in the daytime, OG B0T drops one cheeky line
 * in the Sports Guide group about the next game, a just-finished one, or a
 * members-vs-freeloaders nudge. Never throws; returns a short status.
 */
export async function maybeSportsGroupBanter(admin: Admin, now = Date.now()): Promise<string> {
  try {
    if (!daytimeUK(now)) return "night";
    const { data: row } = await admin.from("site_content").select("value").eq("key", BANTER_KEY).maybeSingle();
    const last = (row as { value?: string } | null)?.value ?? null;
    if (!banterDue(last, now)) return "not due";
    const split = await groupFixtureSplit(admin, now);
    const text = pickGroupBanter(split);
    const { sendTelegramText } = await import("./sports-guide.server");
    const ok = await sendTelegramText(SPORTS_GUIDE_CHAT_ID, text);
    if (!ok) return "failed: send";
    await admin
      .from("site_content")
      .upsert({ key: BANTER_KEY, value: new Date(now).toISOString() }, { onConflict: "key" });
    return "posted";
  } catch {
    return "failed";
  }
}
