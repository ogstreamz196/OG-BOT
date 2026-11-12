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
import { signalRequest, type SignalPair, type SignalTimeframe } from "@/lib/telegram-signals";
import type { CalendarEvent } from "./trade-signal-extras";
import { DEFAULT_ENGINE_CONFIG, type ConcurrencyConfig } from "./engine-config";

type Admin = any;

/** The lowest confidence that gets posted (90% is the engine's top score). */
export const BROADCAST_MIN_CONFIDENCE = 65;
/** From here every timeframe agrees: the alert says TOP. */
const TOP_CONFIDENCE = 90;
/** Gold and Bitcoin (the Boss brought gold back, 2026-11-07). */
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
    /** Where it came from: what the AI desk said is stored with the trade (feeds.desk). */
    feeds?: Record<string, unknown>;
  };
  /** The engine's full read (levels even for a wait), for shadow trades. */
  summary?: import("./trade-signal-context.server").SignalSummary;
};

type ShadowReason = import("./signal-shadows.server").ShadowReason;

/** The same signal with what the AI desk said about it, kept with the trade. */
function withDesk(
  signal: Built,
  desk: "backed" | "no_ai" | "unanimous" | "relaxed",
  extra: Record<string, unknown> = {},
): Built {
  if (!signal.plan) return signal;
  return {
    ...signal,
    plan: { ...signal.plan, feeds: { ...(signal.plan.feeds ?? {}), desk, ...extra } },
  };
}

type PostDeps = {
  /** Posts to the channel; resolves with the message id, or null if it didn't go. */
  post: (text: string) => Promise<number | null>;
  /**
   * The AI desk's check on a chart-engine alert, just before it's posted:
   * the signal to post (the chief may have moved the take profit), or null
   * when the desk is against it (or it's too late in this run to ask).
   */
  confirm?: (signal: Built) => Promise<Built | null>;
  /** The test account's lot and balance on the card (paper-account.server.ts), when it's running. */
  paper?: (signal: Built) => Promise<Built>;
  /**
   * The last check before an alert goes out (signal-gate.ts): a reason to
   * hold it back when its record says it's a loser, else null.
   */
  gate?: (signal: Built) => Promise<string | null>;
  /** Keeps a silent shadow of a setup that isn't sent (signal-shadows.server.ts). */
  shadow?: (signal: Built, reason: ShadowReason) => Promise<void>;
  follow?: (signal: Built, messageId: number, card: string) => Promise<void>;
  now: () => number;
};

export type ScanDeps = PostDeps & {
  build: (ask: string) => Promise<Built>;
  /** The scalp timeframes scanned (default just 5-minute). */
  frames?: SignalTimeframe[];
  /** The markets scanned (default BROADCAST_MARKETS); set for a one-market send. */
  markets?: SignalPair[];
  /** The confidence an alert needs for a market (learned; default BROADCAST_MIN_CONFIDENCE). */
  alertBar?: (market: string) => Promise<number>;
};

/** The lines a signals-chat card keeps: the trade, the stop, the take profit, timeframe and confidence. */
const CARD_KEEPS = ["🟢", "🔴", "🛑", "🎯", "⏱"];

/**
 * The signals chat's card, as the Boss wants it: just the trade, the stop,
 * the take profit (with the money on the demo's lot) and the timeframe and
 * confidence. Everything else (the demo balance and lot, the profit-lock
 * plan, set-ups, warnings, news) is left off: the results post at the bottom
 * of the chat covers the balance, and updates still go into the card as the
 * trade runs. A reply that isn't a trade card is left as it is.
 */
export function compactCard(reply: string): string {
  const kept = reply
    .split("\n")
    .filter((l) => CARD_KEEPS.some((k) => l.startsWith(k)))
    // No money on the trade bot's card (the Boss's split): the Copy Trader
    // B0T's tally covers lots and dollars.
    .map((l) => l.replace(/ · [−+-]\$[\d,]+(?:\.\d+)?/g, ""));
  return kept.length ? kept.join("\n") : reply;
}

/** The scanner's chart for a card's timeframe label ("1M", "5M", "15M", "1H"); 5m otherwise. */
export function frameOf(label: string | undefined): SignalTimeframe {
  const f = (label ?? "").toLowerCase() as SignalTimeframe;
  return (["1m", "5m", "15m", "1h"] as SignalTimeframe[]).includes(f) ? f : "5m";
}

/** The card as posted in the signals chat (compactCard); the card carries the confidence %. */
export function channelCard(reply: string, _confidencePct = TOP_CONFIDENCE): string {
  return compactCard(reply);
}

export async function scanAndBroadcast(
  admin: Admin,
  deps: ScanDeps,
): Promise<{ checked: number; posted: string[] }> {
  const posted: string[] = [];
  let checked = 0;
  const scanMarkets = deps.markets ?? BROADCAST_MARKETS;
  const scans = (deps.frames ?? ["5m"]).flatMap((frame) =>
    scanMarkets.map((pair) => ({ pair, frame })),
  );
  for (const { pair, frame } of scans) {
    let signal: Built;
    try {
      signal = await deps.build(signalRequest(pair, frame));
    } catch (e) {
      console.warn(`[signals] scan of ${pair} ${frame} failed`, e);
      continue;
    }
    checked++;
    const plan = signal.plan;
    // What isn't sent is still followed, silently, for the Boss's report.
    if (!plan) {
      const { waitReasonKind } = await import("./signal-shadows.server");
      const why = waitReasonKind(signal.summary?.waitReason);
      if (why && deps.shadow) await deps.shadow(signal, why);
      continue;
    }
    const bar = deps.alertBar
      ? await deps.alertBar(plan.market).catch(() => BROADCAST_MIN_CONFIDENCE)
      : BROADCAST_MIN_CONFIDENCE;
    if (plan.confidencePct < bar) {
      if (deps.shadow) await deps.shadow(signal, "below_alert");
      continue;
    }
    if (await postOnce(admin, deps, signal, (s) => channelCard(s.reply, plan.confidencePct), true))
      posted.push(
        `${plan.market} ${plan.direction}${frame === "5m" ? "" : ` ${frame.toUpperCase()}`}`,
      );
  }
  return { checked, posted };
}

type PostRow = {
  direction: string;
  message_id?: number | null;
  created_at?: string;
  entry?: number | null;
};

/** After a stop loss, the same side isn't posted again for this long. */
export const AFTER_STOP_MS = 3 * 60_000;
/**
 * Most alerts one market can have running at once (the Boss, 2026-11-03:
 * "increase the frequency, up to 10 trades at the same time, any direction").
 * Same confidence bar — more trades come from room and shorter cooldowns, not
 * a lower bar.
 */
export const MAX_RUNNING_PER_MARKET = 10;
/** A second same-side alert waits at least this long after the last running one. */
export const SAME_SIDE_GAP_MS = 90_000;
/** Entries closer than this share of the risk are the same setup, not a new trade. */
export const SAME_SETUP_R = 0.3;
/** This many trades can run on the base bar before the bar starts rising. */
export const CONCURRENCY_FREE = 3;
/** Each extra concurrent trade adds this much to the confidence needed. */
export const CONCURRENCY_STEP = 2;
/** The concurrency-scaled bar never climbs past this. */
export const CONCURRENCY_BAR_MAX = 84;

/**
 * As more trades run at once, the next one needs more confidence (the Boss,
 * 2026-11-04, accuracy): the first CONCURRENCY_FREE run on the base bar, each
 * extra adds CONCURRENCY_STEP, capped at CONCURRENCY_BAR_MAX. Offsets the
 * higher concurrency cap so the last slots aren't filled with weak setups. Pure.
 */
export function concurrencyBar(
  running: number,
  cfg: { free: number; step: number; barMax: number } = {
    free: CONCURRENCY_FREE,
    step: CONCURRENCY_STEP,
    barMax: CONCURRENCY_BAR_MAX,
  },
): number {
  // No extra floor for the first few (desk/random keep their own lower bars).
  if (running <= cfg.free) return 0;
  const extra = running - cfg.free;
  return Math.min(cfg.barMax, BROADCAST_MIN_CONFIDENCE + extra * cfg.step);
}

type TradeState = "running" | "stopped_recently" | "over";

/**
 * Where the trade behind a still-valid alert stands: running (or unknown: no
 * tracked trade, no table), stopped out less than AFTER_STOP_MS ago, or over
 * (take profit, called off, or stopped out longer ago).
 */
async function tradeState(
  admin: Admin,
  market: string,
  post: PostRow,
  now: number,
  afterStopMs: number = AFTER_STOP_MS,
): Promise<TradeState> {
  if (!post.message_id) return "running";
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
    if (error || !row) return "running";
    const { isActive } = await import("./trade-signal-outcome");
    if (isActive(row.status as never)) return "running";
    if (row.status === "stopped") {
      const closed = Date.parse(row.closed_at ?? "");
      return Number.isFinite(closed) && now - closed >= afterStopMs ? "over" : "stopped_recently";
    }
    return "over";
  } catch {
    return "running";
  }
}

/**
 * Whether a new alert may run alongside the market's other still-valid ones.
 * Several trades can run at once: up to MAX_RUNNING_PER_MARKET per market,
 * either side. A same-side one waits SAME_SIDE_GAP_MS after the last running
 * one on that side, must enter at least SAME_SETUP_R of the risk away from
 * each of them (else it's the same setup found again), and that side sits out
 * AFTER_STOP_MS after a stop loss.
 */
async function roomForAnother(
  admin: Admin,
  plan: NonNullable<Built["plan"]>,
  stop: number | undefined,
  posts: PostRow[],
  now: number,
  cfg: ConcurrencyConfig = DEFAULT_ENGINE_CONFIG.concurrency,
): Promise<boolean> {
  const afterStopMs = cfg.afterStopMins * 60_000;
  const states = await Promise.all(
    posts.map((p) => tradeState(admin, plan.market, p, now, afterStopMs)),
  );
  const running = posts.filter((_, i) => states[i] === "running");
  if (running.length >= cfg.perMarket) return false;
  const same = (p: PostRow) => p.direction === plan.direction;
  // The more already running on its side, the surer this one has to be. A
  // hedge (the other side) only counts trades on its own side, so it goes out
  // at the base bar (the Boss, 2026-11-11: "try increase hedging").
  if (plan.confidencePct < concurrencyBar(running.filter(same).length, cfg)) return false;
  if (posts.some((p, i) => same(p) && states[i] === "stopped_recently")) return false;
  const risk = stop != null ? Math.abs(plan.entry - stop) : NaN;
  const sameSideGapMs = cfg.sameSideGapMins * 60_000;
  for (const p of running.filter(same)) {
    const at = Date.parse(p.created_at ?? "");
    if (Number.isFinite(at) && now - at < sameSideGapMs) return false;
    if (
      risk > 0 &&
      p.entry != null &&
      Math.abs(Number(p.entry) - plan.entry) < cfg.sameSetupR * risk
    )
      return false;
  }
  return true;
}

/**
 * Posts an alert when there's room for it alongside the market's other
 * running ones (roomForAnother), then follows it and logs it in
 * signal_broadcasts. True if it went.
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
  // Alerts from before the Boss's last purge of the chat don't count any more.
  const { chatPurgedAt } = await import("./signal-chat.server");
  const purgedAt = await chatPurgedAt().catch(() => null);
  const { data: live, error } = await admin
    .from(POSTS)
    .select("direction, message_id, created_at, entry")
    .eq("market", plan.market)
    .gt("expires_at", nowIso)
    .gte("created_at", new Date(purgedAt ?? 0).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  // Without the table there's no way to tell repeats apart: post nothing.
  if (error) {
    console.warn("[signals] broadcast check failed", error.message);
    return false;
  }
  // Several trades can run at once, but not the same setup twice. The limits
  // (per-market cap, concurrency bar, gaps, cooldown) come from the Boss's
  // engine config, falling back to the defaults = the original constants.
  const engineCfg = await import("./engine-config.server")
    .then((m) => m.engineConfig())
    .catch(() => DEFAULT_ENGINE_CONFIG);
  if (
    !(await roomForAnother(
      admin,
      plan,
      signal.summary?.stop,
      (live ?? []) as PostRow[],
      deps.now(),
      engineCfg.concurrency,
    ))
  )
    return false;

  // Only what's most likely to win goes out (signal-gate.ts); the rest is
  // followed silently, so learning still sees it. Before the desk, so a
  // held-back alert never costs an AI call.
  const held = deps.gate ? await deps.gate(signal).catch(() => null) : null;
  if (held) {
    await deps.shadow?.(signal, "losing_record").catch(() => undefined);
    return false;
  }
  // Every AI works with the chart engine: an engine alert only goes out when
  // the desk backs it (asked only now, so repeats never cost an AI call).
  if (askDesk && deps.confirm) {
    const backed = await deps.confirm(signal);
    if (!backed?.plan || backed.plan.direction !== plan.direction) return false;
    signal = backed;
  }
  if (deps.paper) signal = await deps.paper(signal).catch(() => signal);
  const text = card(signal);
  const messageId = await deps.post(text);
  if (messageId === null) return false;
  await deps.follow?.(signal, messageId, text);
  await admin.from(POSTS).insert({
    market: plan.market,
    timeframe: signal.summary?.timeframe ?? "5M",
    direction: plan.direction,
    confidence_pct: plan.confidencePct,
    entry: plan.entry,
    expires_at: plan.expiresAt,
    message_id: messageId,
    // The scan's own clock, so the same-side gap is measured on one clock.
    created_at: new Date(deps.now()).toISOString(),
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
  opts: {
    now: () => number;
    askUntil: number;
    /** Called with each alert the desk turns down (kept as a shadow trade). */
    onVeto?: (signal: Built) => Promise<void>;
    /**
     * True when the desk's "no" has been learned off for this market (its
     * turned-down alerts kept winning): the alert goes out without asking.
     */
    skipDesk?: (market: string) => Promise<boolean>;
  },
): (signal: Built) => Promise<Built | null> {
  return async (signal) => {
    const plan = signal.plan;
    if (!plan) return null;
    const now = opts.now();
    // The desk's "no" learned off here: no need to ask (saves the AI too).
    if (await opts.skipDesk?.(plan.market).catch(() => false))
      return withDesk(signal, "relaxed", { relaxed: "desk_no" });
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
    // The same chart the alert came from (1-, 5-, 15-minute or hourly).
    const frame = frameOf(signal.summary?.timeframe);
    const out = await read(signalRequest(pair, frame)).catch(() => null);
    if (!out?.desk) return withDesk(signal, "no_ai");
    const { deskBacks } = await import("./signal-desk.server");
    if (deskBacks(out.desk, plan.direction) && out.signal.plan?.direction === plan.direction)
      return withDesk(out.signal, "backed");
    await opts.onVeto?.(signal).catch(() => undefined);
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
  return compactCard(reply);
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
        const posted = await postOnce(admin, deps, withDesk(read.signal, "unanimous"), (s) =>
          deskCard(s.reply),
        );
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

/* ── Random signals: a strategy picked at random, the request style ───── */

export type RandomDeps = PostDeps & {
  /** The member-request signal (buildTradeSignal), for the chart engine and each setup. */
  build: (ask: string) => Promise<Built>;
  /** The AI desk's read of the chart (deskRead, budgeted), for the "desk" strategy. */
  read: (ask: string) => Promise<DeskRead>;
  rand?: () => number;
};

/**
 * When a random signal is due (every 30 to 90 minutes, at random), picks a
 * strategy (pickStrategy: leaning towards what's been winning, still trying
 * the rest), a market and a chart, and posts that strategy's signal if it has
 * one right now at RANDOM_MIN_CONFIDENCE or more; otherwise it tries again
 * next minute with a fresh pick. Posted like any alert (postOnce: no
 * repeats, the demo account, followed and counted), its card tagged with the
 * strategy, feeds.strategy kept so the picker learns. Says what happened.
 */
export async function maybeRandomSignal(admin: Admin, deps: RandomDeps): Promise<string> {
  try {
    const rnd = await import("./signal-random.server");
    const rand = deps.rand ?? Math.random;
    const now = deps.now();
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", rnd.RANDOM_NEXT_KEY)
      .maybeSingle();
    const due = Date.parse((data as { value?: string } | null)?.value ?? "");
    if (Number.isFinite(due) && now < due) return "not due";
    // The strategy and the chart, each leaning towards what's been making money.
    const stats = await rnd.signalStats(admin, now);
    const strategy = rnd.pickStrategy(stats.strategies, rand);
    const pair = BROADCAST_MARKETS[Math.floor(rand() * BROADCAST_MARKETS.length)];
    const frame: SignalTimeframe = rnd.pickFrame(stats.frames, rand);
    const ask = rnd.strategyAsk(signalRequest(pair, frame), strategy);
    let signal: Built;
    if (strategy === "desk") {
      const read = await deps.read(ask);
      const { deskBacks } = await import("./signal-desk.server");
      const plan = read.signal.plan;
      if (!read.desk || !plan || !deskBacks(read.desk, plan.direction))
        return `${strategy} ${pair} ${frame}: nothing now`;
      signal = withDesk(read.signal, "backed");
    } else {
      signal = await deps.build(ask);
      // The chart engine on its own: not a setup standing in for it.
      if (strategy === "engine" && signal.plan?.feeds?.setup)
        return `engine ${pair} ${frame}: nothing now`;
    }
    const plan = signal.plan;
    if (!plan || plan.confidencePct < rnd.RANDOM_MIN_CONFIDENCE)
      return `${strategy} ${pair} ${frame}: nothing now`;
    // A quick one against the 1-hour trend isn't posted (free: a chart read, no AI).
    if (frame !== "1h") {
      const h = await deps.build(signalRequest(pair, "1h")).catch(() => null);
      // The hour's lean even when it's a wait (summary), else its trade.
      const hour = h?.summary ?? h?.plan;
      if (rnd.againstTheHour(frame, plan.direction, hour))
        return `${strategy} ${pair} ${frame}: against the 1h trend`;
    }
    signal = { ...signal, plan: { ...plan, feeds: { ...(plan.feeds ?? {}), strategy } } };
    const posted = await postOnce(admin, deps, signal, (s) =>
      rnd.tagStrategy(compactCard(s.reply), strategy),
    );
    if (!posted) return `${strategy} ${pair} ${frame}: not posted`;
    // Posted: the next one somewhere in RANDOM_EVERY_MIN (10 to 25 minutes).
    const [lo, hi] = rnd.RANDOM_EVERY_MIN;
    const next = new Date(now + (lo + rand() * (hi - lo)) * 60_000).toISOString();
    await admin
      .from("site_content")
      .upsert(
        { key: rnd.RANDOM_NEXT_KEY, value: next, updated_at: new Date(now).toISOString() },
        { onConflict: "key" },
      );
    return `posted ${strategy} ${pair} ${frame}`;
  } catch (e) {
    console.warn("[signals] random signal failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/* ── Hedges (the Boss's "hedges" strategy switch, off by default) ─────────── */

/** A hedge's own confidence floor: counter-trend reversals score lower by design. */
export const HEDGE_MIN_CONFIDENCE = 55;
/** How often each market is checked for a hedge (a chart read each time). */
export const HEDGE_EVERY_MS = 60_000;
const hedgeTryKey = (market: string) => `signals.hedge.lastTry.${market}`;

/**
 * Which side a hedge would take for a market, from its running trades: the
 * other side of the trend trades, when they all lean one way and no hedge is
 * running there already (one hedge per market at a time). Null otherwise. Pure.
 */
export function hedgeSideFor(
  running: { direction: "BUY" | "SELL"; hedge?: boolean }[],
): "BUY" | "SELL" | null {
  if (running.some((r) => r.hedge)) return null;
  const sides = new Set(running.filter((r) => !r.hedge).map((r) => r.direction));
  if (sides.size !== 1) return null;
  return sides.has("BUY") ? "SELL" : "BUY";
}

/** The hedge's line on its card. Pure. */
export function tagHedge(card: string): string {
  return `${card}\n🛡 Hedge: against the running trade, one 1R target, stop to my entry at 0.5R`;
}

/**
 * The hedge step, once a scan run (the Boss, 2026-11-12: "more hedging, buys
 * and sells against each other"). Only with the "hedges" strategy switch on.
 * For each market whose running trend trades all lean one way, at most once
 * a minute, it asks the chart for a counter-trend reversal on the other side
 * (buildTradeSignal "hedge:<side>", hedgePlan) and posts it through postOnce,
 * so it faces the same cap, repeat checks and gate (at HEDGE_MIN_CONFIDENCE)
 * and is followed, copied and counted like any alert. Never throws.
 */
export async function maybeHedgeSignal(
  admin: Admin,
  deps: PostDeps & { build: (ask: string) => Promise<Built> },
): Promise<string> {
  try {
    const { engineConfig } = await import("./engine-config.server");
    const cfg = await engineConfig().catch(() => null);
    if (!cfg?.strategies?.hedges) return "off";
    const now = deps.now();
    const { chatPurgedAt } = await import("./signal-chat.server");
    const purgedAt = await chatPurgedAt().catch(() => null);
    const purgedMs = purgedAt == null ? 0 : new Date(purgedAt).getTime() || 0;
    const since = Math.max(purgedMs, now - 12 * 3600_000);
    const { data } = await admin
      .from("trade_signals")
      .select("market, direction, feeds")
      .eq("sender_worker", "trade")
      .in("status", ["open", "tp1", "tp2"])
      .gte("created_at", new Date(since).toISOString())
      .limit(100);
    const rows = (
      (data ?? []) as {
        market: string;
        direction: "BUY" | "SELL";
        feeds: { hedge?: boolean; bias?: boolean } | null;
      }[]
    ).filter((r) => !r.feeds?.bias);
    const out: string[] = [];
    for (const pair of BROADCAST_MARKETS) {
      const market = pair === "XAU" ? "XAUUSD" : "BTCUSD";
      const side = hedgeSideFor(
        rows
          .filter((r) => r.market === market)
          .map((r) => ({ direction: r.direction, hedge: !!r.feeds?.hedge })),
      );
      if (!side) continue;
      // At most one chart read a minute per market.
      const { data: last } = await admin
        .from("site_content")
        .select("value")
        .eq("key", hedgeTryKey(market))
        .maybeSingle();
      const lastAt = Date.parse((last as { value?: string } | null)?.value ?? "");
      if (Number.isFinite(lastAt) && now - lastAt < HEDGE_EVERY_MS) continue;
      await admin.from("site_content").upsert(
        {
          key: hedgeTryKey(market),
          value: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "key" },
      );
      const signal = await deps.build(`${signalRequest(pair, "5m")} hedge:${side}`);
      const plan = signal.plan;
      if (!plan?.feeds?.hedge || plan.direction !== side) {
        out.push(`${market} ${side}: no hedge setup`);
        continue;
      }
      if (plan.confidencePct < HEDGE_MIN_CONFIDENCE) {
        out.push(`${market} ${side}: only ${plan.confidencePct}%`);
        continue;
      }
      const posted = await postOnce(admin, deps, signal, (s) => tagHedge(compactCard(s.reply)));
      out.push(`${market} ${side}: ${posted ? "posted" : "not posted"}`);
    }
    return out.length ? out.join("; ") : "no running trend trade to hedge";
  } catch (e) {
    console.warn("[signals] hedge step failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/* ── Range hedging (the Boss's "rangeHedge" strategy switch, off by default) ── */

const rangeTryKey = (market: string) => `signals.rangeHedge.lastTry.${market}`;

/**
 * The edges a range hedge may still take for a market: each side that has no
 * range hedge running there already (at most one buy and one sell at a time,
 * fighting each other). Pure.
 */
export function rangeSidesFree(
  running: { direction: "BUY" | "SELL"; rangeHedge?: boolean }[],
): ("BUY" | "SELL")[] {
  const taken = new Set(running.filter((r) => r.rangeHedge).map((r) => r.direction));
  return (["BUY", "SELL"] as const).filter((s) => !taken.has(s));
}

/** The range hedge's line on its card. Pure. */
export function tagRangeHedge(card: string): string {
  return `${card}\n🔁 Range hedge: fading the edge of a ranging market, one target at the middle, stop to my entry halfway there`;
}

/**
 * The range-hedge step, once a scan run (the Boss, 2026-11-12: "when a market
 * is just ranging, buys and sells that fight each other instead of chasing
 * take-profit"). Only with the "rangeHedge" switch on. For each market, at
 * most once a minute, it asks the chart for the range fade on each edge that
 * has no range hedge running (buildTradeSignal "range:<side>", rangeHedgePlan)
 * and posts what shows through postOnce (cap, repeats, the gate at the hedge
 * floor, the demo account, follow, copy), so a buy at the bottom and a sell at
 * the top can run together. Never throws.
 */
export async function maybeRangeHedge(
  admin: Admin,
  deps: PostDeps & { build: (ask: string) => Promise<Built> },
): Promise<string> {
  try {
    const { engineConfig } = await import("./engine-config.server");
    const cfg = await engineConfig().catch(() => null);
    if (!cfg?.strategies?.rangeHedge) return "off";
    const now = deps.now();
    const { chatPurgedAt } = await import("./signal-chat.server");
    const purgedAt = await chatPurgedAt().catch(() => null);
    const purgedMs = purgedAt == null ? 0 : new Date(purgedAt).getTime() || 0;
    const since = Math.max(purgedMs, now - 12 * 3600_000);
    const { data } = await admin
      .from("trade_signals")
      .select("market, direction, feeds")
      .eq("sender_worker", "trade")
      .in("status", ["pending", "open", "tp1", "tp2"])
      .gte("created_at", new Date(since).toISOString())
      .limit(100);
    const rows = (data ?? []) as {
      market: string;
      direction: "BUY" | "SELL";
      feeds: { rangeHedge?: boolean } | null;
    }[];
    const out: string[] = [];
    for (const pair of BROADCAST_MARKETS) {
      const market = pair === "XAU" ? "XAUUSD" : "BTCUSD";
      const free = rangeSidesFree(
        rows
          .filter((r) => r.market === market)
          .map((r) => ({ direction: r.direction, rangeHedge: !!r.feeds?.rangeHedge })),
      );
      if (!free.length) continue;
      const { data: last } = await admin
        .from("site_content")
        .select("value")
        .eq("key", rangeTryKey(market))
        .maybeSingle();
      const lastAt = Date.parse((last as { value?: string } | null)?.value ?? "");
      if (Number.isFinite(lastAt) && now - lastAt < HEDGE_EVERY_MS) continue;
      const at = new Date(now).toISOString();
      await admin
        .from("site_content")
        .upsert({ key: rangeTryKey(market), value: at, updated_at: at }, { onConflict: "key" });
      for (const side of free) {
        const signal = await deps.build(`${signalRequest(pair, "5m")} range:${side}`);
        const plan = signal.plan;
        if (!plan?.feeds?.rangeHedge || plan.direction !== side) continue;
        if (plan.confidencePct < HEDGE_MIN_CONFIDENCE) {
          out.push(`${market} ${side}: only ${plan.confidencePct}%`);
          continue;
        }
        const posted = await postOnce(admin, deps, signal, (s) =>
          tagRangeHedge(compactCard(s.reply)),
        );
        out.push(`${market} ${side}: ${posted ? "posted" : "not posted"}`);
      }
      if (!out.some((o) => o.startsWith(market))) out.push(`${market}: not ranging at an edge`);
    }
    return out.length ? out.join("; ") : "range hedges running on both edges";
  } catch (e) {
    console.warn("[signals] range hedge step failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/* ── Patterns alongside (the Boss's "patternsAlongside" switch, off by default) ── */

const alongsideTryKey = (market: string) => `signals.alongside.lastTry.${market}`;

/** The alongside card's line, naming the pattern. Pure. */
export function tagAlongside(card: string, setup?: unknown): string {
  const name = typeof setup === "string" && setup ? setup : "a proven pattern";
  return `${card}\n➕ Alongside the engine: ${name}, proven on this chart`;
}

/**
 * The patterns-alongside step, once a scan run (the Boss's switch: "run the
 * proven patterns next to the main engine, not only when it says wait"). With
 * "patternsAlongside" on, each market's 5-minute chart is read at most once a
 * minute for a setup the learning loop has proven there (buildTradeSignal
 * "alongside": only a proven setup, never the engine's own trade) and what
 * shows is posted through postOnce with the normal gate, so it runs beside
 * whatever the engine has open. Never throws.
 */
export async function maybeAlongside(
  admin: Admin,
  deps: PostDeps & { build: (ask: string) => Promise<Built> },
): Promise<string> {
  try {
    const { engineConfig } = await import("./engine-config.server");
    const cfg = await engineConfig().catch(() => null);
    if (!cfg?.strategies?.patternsAlongside) return "off";
    const now = deps.now();
    const out: string[] = [];
    for (const pair of BROADCAST_MARKETS) {
      const market = pair === "XAU" ? "XAUUSD" : "BTCUSD";
      const { data: last } = await admin
        .from("site_content")
        .select("value")
        .eq("key", alongsideTryKey(market))
        .maybeSingle();
      const lastAt = Date.parse((last as { value?: string } | null)?.value ?? "");
      if (Number.isFinite(lastAt) && now - lastAt < HEDGE_EVERY_MS) continue;
      const at = new Date(now).toISOString();
      await admin
        .from("site_content")
        .upsert({ key: alongsideTryKey(market), value: at, updated_at: at }, { onConflict: "key" });
      const signal = await deps.build(`${signalRequest(pair, "5m")} alongside`);
      const plan = signal.plan;
      if (!plan?.feeds?.alongside) {
        out.push(`${market}: no proven pattern`);
        continue;
      }
      const posted = await postOnce(admin, deps, signal, (s) =>
        tagAlongside(compactCard(s.reply), s.plan?.feeds?.setup),
      );
      out.push(`${market} ${plan.direction}: ${posted ? "posted" : "not posted"}`);
    }
    return out.length ? out.join("; ") : "not due";
  } catch (e) {
    console.warn("[signals] alongside step failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}
