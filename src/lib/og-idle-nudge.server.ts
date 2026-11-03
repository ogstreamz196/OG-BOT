// When it's gone quiet (the Boss, 2026-11-03): an hour after a member's last
// message with OG B0T, OG B0T sends them one friendly "I'm bored" message on
// Telegram with a random gold or Bitcoin fact and a conversation starter.
// Never sweary, no AI (a fixed list, so it's free and the facts are right),
// once per quiet spell: the nudge is saved as OG B0T's own message (with an
// invisible mark), so nothing more goes until the member writes again. Only
// for members with Telegram linked who chatted in the last day, between 9am
// and 10pm UK time, a few per run, checked at most every 5 minutes.
type Admin = any;

/** Quiet this long after the last message before the nudge. */
export const IDLE_AFTER_MS = 60 * 60_000;
/** Only members who chatted within this window get one. */
const LOOK_BACK_MS = 24 * 3600_000;
const RUN_EVERY_MS = 5 * 60_000;
const PER_RUN = 10;
const RUN_KEY = "og.idleNudge.lastRun";
/** Invisible mark on a nudge, so it's never sent twice for one quiet spell. */
export const NUDGE_MARK = "⁣";

const OPENERS = [
  "I'm bored 😴",
  "Bit quiet in here, isn't it?",
  "Oi, I'm bored. Talk to me 👀",
  "Nobody's said a word for an hour, so here's something random.",
  "Right, I'm bored, so here's a fun one.",
];

const FACTS = [
  "There will only ever be 21 million bitcoin.",
  "The smallest bit of a bitcoin is a satoshi: one hundred millionth of a coin.",
  "Bitcoin trades 24/7, even on Christmas Day.",
  "A new bitcoin block gets found about every 10 minutes.",
  "Roughly every four years the reward for mining bitcoin halves. The last halving was April 2024.",
  "The first thing ever bought with bitcoin was two pizzas, for 10,000 BTC, back in May 2010.",
  "Weekend bitcoin moves can be sharper because fewer people are trading.",
  "Gold's code XAU comes from aurum, the Latin word for gold.",
  "Gold is priced per troy ounce, which is about 31.1 grams, a bit heavier than a normal ounce.",
  "All the gold ever mined would fit in a cube only about 22 metres wide.",
  "Gold often moves the opposite way to the US dollar: a weaker dollar tends to help gold.",
  "Gold trades almost round the clock on weekdays, from Sunday night to Friday night UK time.",
  "Central banks have been some of the biggest gold buyers in recent years.",
  "Gold often wakes up around the London open, about 8am UK time.",
];

const STARTERS = [
  "What are you up to?",
  "Fancy a BTC signal?",
  "Want me to check the Bitcoin chart for you?",
  "How's your day going?",
  "Did you know that one?",
];

/** One nudge, polite and short. Pure (given `rand`). */
export function pickNudge(rand: () => number = Math.random): string {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length) % a.length];
  return `${pick(OPENERS)} Random one for you: ${pick(FACTS)} ${pick(STARTERS)}`;
}

export type ChatRow = { user_id: string; role: string; content: string; created_at: string };

/**
 * Who's due a nudge: the members whose latest private-chat message is between
 * IDLE_AFTER_MS and a day old and isn't already a nudge. Rows newest first. Pure.
 */
export function dueForNudge(rows: ChatRow[], now = Date.now()): string[] {
  const latest = new Map<string, ChatRow>();
  for (const r of rows) if (!latest.has(r.user_id)) latest.set(r.user_id, r);
  const out: string[] = [];
  for (const [user, r] of latest) {
    const age = now - Date.parse(r.created_at);
    if (!(age >= IDLE_AFTER_MS && age <= LOOK_BACK_MS)) continue;
    if (r.role === "assistant" && r.content.endsWith(NUDGE_MARK)) continue;
    out.push(user);
  }
  return out;
}

/** Between 9am and 10pm UK time. Pure. */
export function awakeHours(now = Date.now()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now)),
  );
  return hour >= 9 && hour < 22;
}

/** Sends the nudges due now. Never throws; returns a short summary. */
export async function maybeIdleNudges(admin: Admin, now = Date.now()): Promise<string> {
  try {
    if (!awakeHours(now)) return "night";
    const { data: run } = await admin
      .from("site_content")
      .select("value")
      .eq("key", RUN_KEY)
      .maybeSingle();
    const last = Date.parse((run as { value?: string } | null)?.value ?? "");
    if (Number.isFinite(last) && now - last < RUN_EVERY_MS) return "not due";
    await admin
      .from("site_content")
      .upsert({ key: RUN_KEY, value: new Date(now).toISOString() }, { onConflict: "key" });

    const { data: rows, error } = await admin
      .from("og_messages")
      .select("user_id, role, content, created_at")
      .gte("created_at", new Date(now - LOOK_BACK_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) return "no messages";
    const due = dueForNudge((rows ?? []) as ChatRow[], now);
    if (!due.length) return "none";

    const { data: people } = await admin
      .from("profiles")
      .select("id, telegram_chat_id")
      .in("id", due.slice(0, 200))
      .not("telegram_chat_id", "is", null);
    const linked = ((people ?? []) as { id: string; telegram_chat_id: number }[]).slice(0, PER_RUN);
    if (!linked.length) return "none linked";

    const { telegramApi } = await import("./telegram-api.server");
    let sent = 0;
    for (const p of linked) {
      const text = pickNudge();
      // Saved first, so a slow send can't make the next run nudge again.
      const { error: saveErr } = await admin
        .from("og_messages")
        .insert({ user_id: p.id, role: "assistant", content: text + NUDGE_MARK });
      if (saveErr) continue;
      // Blocked the bot, or Telegram busy: the saved nudge still stops repeats.
      const res = await telegramApi("sendMessage", { chat_id: p.telegram_chat_id, text }).catch(
        () => null,
      );
      if (res?.ok) sent++;
    }
    return `sent ${sent}`;
  } catch {
    return "failed";
  }
}
