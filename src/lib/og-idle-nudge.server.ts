// When it's gone quiet (the Boss, 2026-11-03): OG B0T says it's bored in the
// signals chat, with a random Bitcoin fact and a conversation starter
// (maybeSignalsChatNudge). Never sweary, no AI (a fixed list, so it's free and
// the facts are right), only between 9am and 10pm UK time. dueForNudge is kept
// for private chats but nothing sends those (the Boss wants the signals chat).
type Admin = any;

/** Quiet this long after the last message before the nudge. */
export const IDLE_AFTER_MS = 60 * 60_000;
/** Only members who chatted within this window get one. */
const LOOK_BACK_MS = 24 * 3600_000;
/** Invisible mark on a nudge, so it's never sent twice for one quiet spell. */
export const NUDGE_MARK = "⁣";

/** "{quiet}" becomes how long it's really been quiet (quietFor). */
const OPENERS = [
  "I'm bored 😴",
  "Bit quiet in here, isn't it?",
  "Oi, I'm bored. Talk to me 👀",
  "Nobody's said a word for {quiet}, so here's something random.",
  "Right, I'm bored, so here's a fun one.",
];

/** How long it's been quiet, in plain words ("an hour", "1 hour 20 minutes", "2 hours"). Pure. */
export function quietFor(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hours = h === 1 ? "an hour" : `${h} hours`;
  if (m < 5) return hours;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minutes`;
}

const FACTS = [
  "There will only ever be 21 million bitcoin.",
  "The smallest bit of a bitcoin is a satoshi: one hundred millionth of a coin.",
  "Bitcoin trades 24/7, even on Christmas Day.",
  "A new bitcoin block gets found about every 10 minutes.",
  "Roughly every four years the reward for mining bitcoin halves. The last halving was April 2024.",
  "The first thing ever bought with bitcoin was two pizzas, for 10,000 BTC, back in May 2010.",
  "Weekend bitcoin moves can be sharper because fewer people are trading.",
  "Bitcoin's creator, Satoshi Nakamoto, has never been identified.",
  "The very first bitcoin block was mined on 3 January 2009.",
  "Bitcoin addresses are free to make: you can have as many as you like.",
];

const STARTERS = [
  "What are you up to?",
  "Fancy a BTC signal?",
  "Want me to check the Bitcoin chart for you?",
  "How's your day going?",
  "Did you know that one?",
];

/**
 * One nudge, polite and short. `quietMs` is how long the chat has really been
 * quiet; without it, no opener names a time. Pure (given `rand`).
 */
export function pickNudge(rand: () => number = Math.random, quietMs?: number): string {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length) % a.length];
  const openers =
    quietMs != null && Number.isFinite(quietMs)
      ? OPENERS.map((o) => o.replace("{quiet}", quietFor(quietMs)))
      : OPENERS.filter((o) => !o.includes("{quiet}"));
  return `${pick(openers)} Random one for you: ${pick(FACTS)} ${pick(STARTERS)}`;
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

const CHAT_KEY = "signals.chat.boredAt";

/**
 * The signals chat (the Boss: "all this is for the signals chat"): after an
 * hour with nothing new in it (no alert, no update, no member's signal), OG
 * B0T posts one friendly "I'm bored" message with a Bitcoin fact, and
 * again each hour it stays quiet, between 9am and 10pm UK. The last one is
 * deleted when the next goes up, so they never pile up. Never sweary, no AI.
 * Never throws; returns a short summary.
 */
export async function maybeSignalsChatNudge(admin: Admin, now = Date.now()): Promise<string> {
  try {
    if (!awakeHours(now)) return "night";
    const { signalsChatId } = await import("./signal-chat.server");
    const chatId = await signalsChatId();
    if (chatId == null) return "no signals chat";
    // Anything said counts: signal cards and updates, and the group's own chat
    // (members and OG B0T's replies, kept in telegram_group_lines).
    const latest = async (table: string, kinds?: string[]) => {
      let q = admin.from(table).select("created_at").eq("chat_id", chatId);
      if (kinds) q = q.in("kind", kinds);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
      if (error) return NaN;
      return Date.parse((data as { created_at: string }[] | null)?.[0]?.created_at ?? "");
    };
    const lastActivity = lastOf(
      await Promise.all([
        latest("signal_chat_messages", ["card", "update"]),
        latest("telegram_group_lines"),
      ]),
    );
    const { data: row } = await admin
      .from("site_content")
      .select("value")
      .eq("key", CHAT_KEY)
      .maybeSingle();
    const prev = parseBored((row as { value?: string } | null)?.value);
    if (!chatNudgeDue(lastActivity, prev?.at ?? null, now)) return "not due";
    // Says how long it's really been quiet (since the last message, or since
    // the last nudge when that's more recent).
    const since = lastOf([lastActivity, Date.parse(prev?.at ?? "")]);
    const text = pickNudge(Math.random, Number.isFinite(since) ? now - since : undefined);
    const { telegramApi } = await import("./telegram-api.server");
    const sent = await telegramApi<{ message_id?: number }>("sendMessage", {
      chat_id: chatId,
      text,
      disable_notification: true,
    });
    const id = sent?.ok ? sent.result?.message_id : undefined;
    if (!id) return "failed: couldn't post";
    // Only the newest one stays in the chat.
    if (prev?.id)
      await telegramApi("deleteMessage", { chat_id: chatId, message_id: prev.id }).catch(
        () => null,
      );
    await admin
      .from("site_content")
      .upsert(
        { key: CHAT_KEY, value: JSON.stringify({ at: new Date(now).toISOString(), id }) },
        { onConflict: "key" },
      );
    return "posted";
  } catch {
    return "failed";
  }
}

/** The latest of some times (NaN for none). Pure. */
export function lastOf(times: number[]): number {
  const ok = times.filter(Number.isFinite);
  return ok.length ? Math.max(...ok) : NaN;
}

function parseBored(raw: string | null | undefined): { at: string; id?: number } | null {
  try {
    const v = JSON.parse(raw ?? "");
    return v && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Whether the signals chat is due an "I'm bored" message: quiet for an hour
 * (or nothing ever posted) and the last one at least an hour ago. Pure.
 */
export function chatNudgeDue(lastActivity: number, lastNudge: string | null, now: number): boolean {
  const quiet = !Number.isFinite(lastActivity) || now - lastActivity >= IDLE_AFTER_MS;
  const t = lastNudge ? Date.parse(lastNudge) : NaN;
  const spaced = !Number.isFinite(t) || now - t >= IDLE_AFTER_MS;
  return quiet && spaced;
}
