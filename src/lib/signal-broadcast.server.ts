/**
 * Auto-posted scalp signals. Every minute (pg_cron → /api/public/signal-scan)
 * the gold and bitcoin 5-minute scalps are built with the same engine as the
 * bot, and any scoring 70% confidence or more go to the AI desk; the ones it
 * backs are posted to the signals channel by the separate signals bot, with
 * the % on the card.
 *
 * Confidence is indicator agreement (see buildPlan in trade-signal.ts), never a
 * win rate, and it tops out at 90%: a 90% signal is one where every timeframe
 * agrees and nothing (chop, momentum against, light volume, a quiet session)
 * knocks points off.
 *
 * Every 10 minutes, and a few minutes after the times the market usually moves
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
  /**
   * The AI desk's check on a chart-engine alert, just before it's posted:
   * the signal to post (the chief may have moved the take profit), or null
   * when the desk is against it (or it's too late in this run to ask).
   */
  confirm?: (signal: Built) => Promise<Built | null>;
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
    if (await postOnce(admin, deps, signal, (s) => channelCard(s.reply, plan.confidencePct), true))
      posted.push(`${plan.market} ${plan.direction}`);
  }
  return { checked, posted };
}

type PostRow = { direction: string; message_id?: number | null; created_at?: string };

/** After a stop loss, the same side isn't posted again for this long. */
export const AFTER_STOP_MS = 15 * 60_000;

/**
 * Whether the trade behind a still-valid alert is over: it hit its take
 * profit, or its stop loss at least AFTER_STOP_MS ago, or was called off.
 * Unknown (no tracked trade, no table) counts as still running.
 */
async function tradeOver(
  admin: Admin,
  market: string,
  post: PostRow,
  now: number,
): Promise<boolean> {
  if (!post.message_id) return false;
  try {
    let q = admin
      .from("trade_signals")
      .select("status, closed_at")
      .eq("market", market)
      .eq("sender_worker", "trade")
      .eq("message_id", post.message_id);
    // Message ids are per chat: only a trade recorded with this post.
    if (post.created_at)
      q = q.gte("created_at", new Date(Date.parse(post.created_at) - 5 * 60_000).toISOString());
    const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
    const row = ((data ?? []) as { status: string; closed_at: string | null }[])[0];
    if (error || !row) return false;
    const { isActive } = await import("./trade-signal-outcome");
    if (isActive(row.status as never)) return false;
    if (row.status === "stopped") {
      const closed = Date.parse(row.closed_at ?? "");
      return Number.isFinite(closed) && now - closed >= AFTER_STOP_MS;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Posts an alert unless this market already has a still-valid post going the
 * same way whose trade is still running (or just stopped out), then follows it and logs it in signal_broadcasts. True if it went.
 */
async function postOnce(
  admin: Admin,
  deps: PostDeps,
  found: Built,
  card: (s: Built) => string,
  askDesk = false,
) {
  let signal = found;
  const plan = signal.plan;
  if (!plan) return false;
  const nowIso = new Date(deps.now()).toISOString();
  const { data: live, error } = await admin
    .from(POSTS)
    .select("direction, message_id, created_at")
    .eq("market", plan.market)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);
  // Without the table there's no way to tell repeats apart: post nothing.
  if (error) {
    console.warn("[signals] broadcast check failed", error.message);
    return false;
  }
  const last = ((live ?? []) as PostRow[])[0];
  // Same way again: only once the last alert's trade is over, so a trending
  // market isn't sat out for the rest of the hour after a quick take profit.
  if (
    last &&
    last.direction === plan.direction &&
    !(await tradeOver(admin, plan.market, last, deps.now()))
  )
    return false;

  // Every AI works with the chart engine: an engine alert only goes out when
  // the desk backs it (asked only now, so repeats never cost an AI call).
  if (askDesk && deps.confirm) {
    const backed = await deps.confirm(signal);
    if (!backed?.plan || backed.plan.direction !== plan.direction) return false;
    signal = backed;
  }
  const text = card(signal);
  const messageId = await deps.post(text);
  if (messageId === null) return false;
  await deps.follow?.(signal, messageId, text);
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

/** After the desk turns an alert down, that side of that market isn't re-asked for this long. */
export const DESK_VETO_MS = 10 * 60_000;
const vetoKey = (market: string) => `signals.deskVeto.${market}`;

/**
 * The AI desk's check on the chart engine's 70%+ alerts (PostDeps.confirm).
 * The whole desk reads the market (deskRead, the same as a member's request)
 * and the alert goes out when it backs the engine's side (deskBacks), with
 * the chief's take profit. Turned down, that side waits DESK_VETO_MS before
 * the desk is asked again. When no AI can answer at all, the engine's own
 * alert stands, so signals don't vanish on an AI outage. Past `askUntil`
 * nothing is asked (the run would overrun its time) and the alert waits for
 * the next run, without a veto.
 */
export function deskConfirmer(
  admin: Admin,
  read: (ask: string) => Promise<DeskRead>,
  opts: { now: () => number; askUntil: number },
): (signal: Built) => Promise<Built | null> {
  return async (signal) => {
    const plan = signal.plan;
    if (!plan) return null;
    const now = opts.now();
    if (now > opts.askUntil) return null;
    try {
      const { data } = await admin
        .from("site_content")
        .select("value")
        .eq("key", vetoKey(plan.market))
        .maybeSingle();
      const veto = JSON.parse((data as { value?: string } | null)?.value ?? "null") as {
        direction?: string;
        until?: number;
      } | null;
      if (veto?.direction === plan.direction && Number(veto.until) > now) return null;
    } catch {
      /* no veto kept */
    }
    const pair: SignalPair = plan.market.startsWith("XAU") ? "XAU" : "BTC";
    const out = await read(signalRequest(pair, "5m")).catch(() => null);
    if (!out?.desk) return signal;
    const { deskBacks } = await import("./signal-desk.server");
    if (deskBacks(out.desk, plan.direction) && out.signal.plan?.direction === plan.direction)
      return out.signal;
    const at = new Date(now).toISOString();
    await admin.from("site_content").upsert(
      {
        key: vetoKey(plan.market),
        value: JSON.stringify({ direction: plan.direction, until: now + DESK_VETO_MS }),
        updated_at: at,
      },
      { onConflict: "key" },
    );
    return null;
  };
}

/** How often the AI desk scouts gold and bitcoin for the signals chat. */
export const DESK_SCOUT_EVERY_MS = 10 * 60_000;
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

/** Whether the 10-minute desk scout is due (pure, so it can be tested). */
export function deskScoutDue(lastAt: string | null, now: number): boolean {
  const last = lastAt ? Date.parse(lastAt) : NaN;
  // A little early is fine: the minute cron never lands on the same second.
  return !Number.isFinite(last) || now - last >= DESK_SCOUT_EVERY_MS - 30_000;
}

/** The scout's heading (members never hear about the desk). */
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
 * Every 10 minutes, gold and bitcoin go through the same AI desk as a member's
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
    const regular = deskScoutDue((data as { value?: string } | null)?.value ?? null, now);
    // The extra layer: a check a few minutes after the times the market moves.
    const { data: slotRow } = await admin
      .from("site_content")
      .select("value")
      .eq("key", DESK_SCOUT_SLOT)
      .maybeSingle();
    const news = deps.news ? await deps.news().catch(() => []) : [];
    const slot = keySlotDue(now, news, (slotRow as { value?: string } | null)?.value ?? null);
    if (!regular && !slot) return "not due";
    // Claim it first, so two runs at once can't both scout. A key-time check
    // counts as the regular one too, so they don't land minutes apart.
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
        if (!read.desk) return `${pair}: ${read.signal.plan ? "desk didn't decide" : "no setup"}`;
        if (!deskAgrees(read.desk)) return `${pair}: desk split`;
        if (!plan || plan.direction !== read.desk.direction) return `${pair}: no signal that way`;
        const posted = await postOnce(admin, deps, read.signal, (s) => deskCard(s.reply));
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
