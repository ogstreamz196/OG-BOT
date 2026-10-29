/**
 * Auto-posted scalp signals. Every minute (pg_cron → /api/public/signal-scan)
 * the gold and bitcoin 5-minute scalps are built with the same engine as the
 * bot, and any scoring 70% confidence or more are posted to the signals
 * channel by the separate signals bot, with the % on the card.
 *
 * Confidence is indicator agreement (see buildPlan in trade-signal.ts), never a
 * win rate, and it tops out at 90%: a 90% signal is one where every timeframe
 * agrees and nothing (chop, momentum against, light volume, a quiet session)
 * knocks points off.
 *
 * Once an hour, and a few minutes after the times the market usually moves
 * (opens, US data, the gold fix, the London close, high-impact USD news), the
 * AI desk also scouts both markets (maybeDeskScout) and
 * posts the card when every AI agrees, whatever the confidence.
 *
 * A market isn't posted again while its last post is still valid, unless the
 * new signal goes the other way. Needs the SIGNALS_BOT_TOKEN and
 * SIGNALS_CHANNEL_ID secrets; without them the scan does nothing.
 */
import { signalRequest, type SignalPair } from "@/lib/telegram-signals";
import type { CalendarEvent } from "./trade-signal-extras";

type Admin = any;

/** The lowest confidence that gets posted (90% is the engine's top score). */
export const BROADCAST_MIN_CONFIDENCE = 70;
/** From here every timeframe agrees: the alert says TOP. */
const TOP_CONFIDENCE = 90;
export const BROADCAST_MARKETS: SignalPair[] = ["XAU", "BTC"];
const POSTS = "signal_broadcasts";

type Built = {
  reply: string;
  plan?: {
    market: string;
    label: string;
    direction: "BUY" | "SELL";
    confidencePct: number;
    entry: number;
    expiresAt: string;
  };
};

type PostDeps = {
  /** Posts to the channel; resolves with the message id, or null if it didn't go. */
  post: (text: string) => Promise<number | null>;
  follow?: (signal: Built, messageId: number, card: string) => Promise<void>;
  now: () => number;
};

export type ScanDeps = PostDeps & {
  build: (ask: string) => Promise<Built>;
};

/** The card as posted; the card itself carries the confidence %. */
export function channelCard(reply: string, confidencePct = TOP_CONFIDENCE): string {
  return confidencePct >= TOP_CONFIDENCE ? `🔥 Every timeframe agrees\n${reply}` : reply;
}

export async function scanAndBroadcast(
  admin: Admin,
  deps: ScanDeps,
): Promise<{ checked: number; posted: string[] }> {
  const posted: string[] = [];
  let checked = 0;
  for (const pair of BROADCAST_MARKETS) {
    let signal: Built;
    try {
      signal = await deps.build(signalRequest(pair, "5m"));
    } catch (e) {
      console.warn(`[signals] scan of ${pair} failed`, e);
      continue;
    }
    checked++;
    const plan = signal.plan;
    if (!plan || plan.confidencePct < BROADCAST_MIN_CONFIDENCE) continue;
    if (await postOnce(admin, deps, signal, channelCard(signal.reply, plan.confidencePct)))
      posted.push(`${plan.market} ${plan.direction}`);
  }
  return { checked, posted };
}

/**
 * Posts an alert unless this market already has a still-valid post going the
 * same way, then follows it and logs it in signal_broadcasts. True if it went.
 */
async function postOnce(admin: Admin, deps: PostDeps, signal: Built, card: string) {
  const plan = signal.plan;
  if (!plan) return false;
  const nowIso = new Date(deps.now()).toISOString();
  const { data: live, error } = await admin
    .from(POSTS)
    .select("direction")
    .eq("market", plan.market)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);
  // Without the table there's no way to tell repeats apart: post nothing.
  if (error) {
    console.warn("[signals] broadcast check failed", error.message);
    return false;
  }
  const last = ((live ?? []) as { direction: string }[])[0];
  if (last && last.direction === plan.direction) return false;

  const messageId = await deps.post(card);
  if (messageId === null) return false;
  await deps.follow?.(signal, messageId, card);
  await admin.from(POSTS).insert({
    market: plan.market,
    timeframe: "5M",
    direction: plan.direction,
    confidence_pct: plan.confidencePct,
    entry: plan.entry,
    expires_at: plan.expiresAt,
    message_id: messageId,
  });
  return true;
}

/** How often the AI desk scouts gold and bitcoin for the signals chat. */
export const DESK_SCOUT_EVERY_MS = 60 * 60_000;
const DESK_SCOUT_LAST = "signals.deskScout.lastAt";
const DESK_SCOUT_SLOT = "signals.deskScout.lastSlot";

/**
 * The times gold and bitcoin usually move, each checked a few minutes after
 * (once the first candles are in), weekdays in that market's own time zone,
 * so daylight saving is handled. High-impact USD news is added on top.
 */
export const KEY_TIMES = [
  { id: "tokyo", label: "Tokyo open", tz: "Asia/Tokyo", h: 9, m: 0 },
  { id: "london", label: "London open", tz: "Europe/London", h: 8, m: 0 },
  { id: "usdata", label: "US data time", tz: "America/New_York", h: 8, m: 30 },
  { id: "nyopen", label: "New York open", tz: "America/New_York", h: 9, m: 30 },
  { id: "goldfix", label: "London gold fix", tz: "Europe/London", h: 15, m: 0 },
  { id: "londonclose", label: "London close", tz: "Europe/London", h: 16, m: 30 },
] as const;
/** A key time is checked from 3 to 10 minutes after it. */
const KEY_FROM_MS = 3 * 60_000;
const KEY_UNTIL_MS = 10 * 60_000;

/** How far ahead of UTC a time zone is at `ms`. */
function zoneOffset(ms: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return (
    Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - (ms - (ms % 1000))
  );
}

/** Today's h:m in a time zone (today there), and whether it's a weekday there. */
export function zonedToday(now: number, tz: string, h: number, m: number) {
  const off = zoneOffset(now, tz);
  const local = new Date(now + off);
  const guess =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - off;
  const at = guess - (zoneOffset(guess, tz) - off);
  const day = local.getUTCDay();
  return { at, weekday: day >= 1 && day <= 5, ymd: local.toISOString().slice(0, 10) };
}

/** The key time (or high-impact USD news) due a check right now, if any. */
export function keySlotDue(
  now: number,
  news: CalendarEvent[],
  lastSlot: string | null,
): { id: string; label: string } | null {
  const slots: { id: string; label: string; at: number }[] = [];
  for (const k of KEY_TIMES) {
    const z = zonedToday(now, k.tz, k.h, k.m);
    if (z.weekday) slots.push({ id: `${k.id}:${z.ymd}`, label: k.label, at: z.at });
  }
  for (const e of news)
    if (e.impact === "High" && e.currency === "USD")
      slots.push({ id: `news:${e.at}`, label: `After ${e.title}`, at: e.at });
  const due = slots.find(
    (s) => now >= s.at + KEY_FROM_MS && now < s.at + KEY_UNTIL_MS && s.id !== lastSlot,
  );
  return due ? { id: due.id, label: due.label } : null;
}

/** Whether the hourly desk scout is due (pure, so it can be tested). */
export function deskScoutDue(lastAt: string | null, now: number): boolean {
  const last = lastAt ? Date.parse(lastAt) : NaN;
  // A little early is fine: the minute cron never lands on the same second.
  return !Number.isFinite(last) || now - last >= DESK_SCOUT_EVERY_MS - 30_000;
}

/** The hourly scout's heading (members never hear about the desk). */
export function deskCard(reply: string): string {
  return reply;
}

type DeskRead = {
  signal: Built;
  desk: import("./signal-desk.server").DeskDecision | null;
};

export type DeskScoutDeps = PostDeps & {
  /** This week's economic calendar, for the news-time checks. */
  news?: () => Promise<CalendarEvent[]>;
  /** The member-request signal (deskRead), with the desk's own call. */
  read: (ask: string) => Promise<DeskRead>;
};

/**
 * Once an hour, gold and bitcoin go through the same AI desk as a member's
 * request. A market is posted only when every AI on the desk agrees and the
 * engine has a real signal that way, whatever its confidence; separate from
 * the 70%+ scanner. Market-bias calls are never posted. Says what happened.
 */
export async function maybeDeskScout(admin: Admin, deps: DeskScoutDeps): Promise<string> {
  try {
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", DESK_SCOUT_LAST)
      .maybeSingle();
    const now = deps.now();
    const hourly = deskScoutDue((data as { value?: string } | null)?.value ?? null, now);
    // The extra layer: a check a few minutes after the times the market moves.
    const { data: slotRow } = await admin
      .from("site_content")
      .select("value")
      .eq("key", DESK_SCOUT_SLOT)
      .maybeSingle();
    const news = deps.news ? await deps.news().catch(() => []) : [];
    const slot = keySlotDue(now, news, (slotRow as { value?: string } | null)?.value ?? null);
    if (!hourly && !slot) return "not due";
    // Claim it first, so two runs at once can't both scout. A key-time check
    // counts as the hour's too, so they don't land minutes apart.
    const at = new Date(now).toISOString();
    await admin
      .from("site_content")
      .upsert({ key: DESK_SCOUT_LAST, value: at, updated_at: at }, { onConflict: "key" });
    if (slot)
      await admin
        .from("site_content")
        .upsert({ key: DESK_SCOUT_SLOT, value: slot.id, updated_at: at }, { onConflict: "key" });
    const { deskAgrees } = await import("./signal-desk.server");
    const results = await Promise.all(
      BROADCAST_MARKETS.map(async (pair) => {
        let read: DeskRead;
        try {
          read = await deps.read(signalRequest(pair, "5m"));
        } catch (e) {
          console.warn(`[signals] desk scout of ${pair} failed`, e);
          return `${pair}: failed`;
        }
        const plan = read.signal.plan;
        if (!read.desk) return `${pair}: desk didn't decide`;
        if (!deskAgrees(read.desk)) return `${pair}: desk split`;
        if (!plan || plan.direction !== read.desk.direction) return `${pair}: no signal that way`;
        const posted = await postOnce(admin, deps, read.signal, deskCard(read.signal.reply));
        return posted ? `${pair}: posted ${plan.direction}` : `${pair}: already posted`;
      }),
    );
    return `${slot ? `${slot.label}: ` : ""}${results.join(", ")}`;
  } catch (e) {
    console.warn("[signals] desk scout failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/** Posts to the signals channel with the signals bot. Null when not set up or it failed. */
export async function postToSignalsChannel(text: string): Promise<number | null> {
  const token = process.env.SIGNALS_BOT_TOKEN;
  const chatId = normaliseChannelId(process.env.SIGNALS_CHANNEL_ID);
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    } | null;
    if (!json?.ok) {
      // Never log the URL: it carries the token.
      console.error(`[signals] channel post failed: ${json?.description ?? res.status}`);
      return null;
    }
    return json.result?.message_id ?? null;
  } catch (e) {
    console.error("[signals] channel post failed", (e as Error).message);
    return null;
  }
}

export const signalsChannelReady = () =>
  !!process.env.SIGNALS_BOT_TOKEN && !!process.env.SIGNALS_CHANNEL_ID;

/** Accepts "4356305046", "-1004356305046" or "@name"; bare digits become a channel id. */
export function normaliseChannelId(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return `-100${v}`;
  return v;
}
