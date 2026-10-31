// Follows every Telegram trade signal after it's sent: records it, checks
// the price every minute (cron → /api/public/trade-signal-watch), tells the
// member when the entry fills, a target or the stop is hit, the higher
// timeframe trend turns against it or time runs out, keeps a live price line
// on the signal card, and builds the honest track record shown on new
// signals. Outcome rules live in trade-signal-outcome.ts.
import type { Instrument } from "./trade-signal";
import type { SignalFeeds, SignalPlan } from "./trade-signal-context.server";
import { backtestKey, parseSavedBacktest, type SavedBacktest } from "./trade-signal-backtest";
import { shiftCandles, spotOffset } from "./trade-signal-extras";
import {
  ACTIVE_STATUSES,
  advanceTimed,
  brokerLevels,
  limitsFrom,
  isActive,
  profitLock,
  targetsReached,
  trackRecordText,
  type OutcomeEvent,
  type SignalStatus,
} from "./trade-signal-outcome";
import { cached } from "./server-cache";

const TABLE = "trade_signals" as never;
const RECORD_DAYS = 30;
/** How often the higher-timeframe trend is re-read for an open setup. */
const TREND_CHECK_MS = 10 * 60_000;
/** How often the live price line on a card is refreshed. */
const LIVE_EDIT_MS = 2 * 60_000;
/** Follow-up messages tidy themselves away after this. */
const FOLLOW_UP_TTL_MS = 6 * 3600_000;
const MINUTE = 60_000;

type Row = {
  id: string;
  user_id: string;
  sender_worker: string | null;
  chat_id: number | null;
  message_id: number | null;
  market: string;
  label: string;
  feeds: SignalFeeds;
  timeframe: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  decimals: number;
  pip: number | null;
  card: string | null;
  status: SignalStatus;
  best_target: number;
  entered_at: string | null;
  last_price: number | null;
  last_candle_at: string | null;
  last_edit_at: string | null;
  last_trend_check_at: string | null;
  expires_at: string;
  created_at: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ── Recording and track record ───────────────────────────────────────── */

/** Stores a signal just sent to a member so it can be followed. Never throws. */
export async function recordSignal(opts: {
  userId: string;
  senderWorker?: string | null;
  chatId: number;
  messageId: number | null;
  card: string;
  plan: SignalPlan;
}): Promise<void> {
  const { plan } = opts;
  const now = new Date().toISOString();
  const market = plan.entryType === "market";
  try {
    const admin = await db();
    const { error } = await admin.from(TABLE).insert({
      user_id: opts.userId,
      sender_worker: opts.senderWorker ?? null,
      chat_id: opts.chatId,
      message_id: opts.messageId,
      market: plan.market,
      label: plan.label,
      feeds: plan.feeds,
      style: plan.style,
      timeframe: plan.timeframe,
      direction: plan.direction,
      entry: plan.entry,
      // Stop (confirmation) entries are pending orders too; feeds.entry says
      // they fill on a break rather than a pullback.
      entry_type: plan.entryType === "stop" ? "limit" : plan.entryType,
      stop: plan.stop,
      tp1: plan.targets[0],
      tp2: plan.targets[1],
      tp3: plan.targets[2],
      confidence_pct: plan.confidencePct,
      quality: plan.quality,
      decimals: plan.decimals,
      pip: plan.pip,
      // One edit line has to fit under Telegram's 4096-character limit.
      card: opts.card.length <= 3800 ? opts.card : null,
      status: market ? "open" : "pending",
      entered_at: market ? now : null,
      expires_at: plan.expiresAt,
    } as never);
    if (error) console.warn("[signals] record failed", error.message);
  } catch (e) {
    console.warn("[signals] record failed", e);
  }
}

/** The Boss's saved backtest for this market and timeframe, or null. Cached 10 min. */
export async function savedBacktest(
  market: string,
  timeframe: string,
): Promise<SavedBacktest | null> {
  return cached(`signal-backtest:${market}:${timeframe}`, 10 * 60_000, async () => {
    const admin = await db();
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", backtestKey(market, timeframe))
      .maybeSingle();
    return parseSavedBacktest((data as { value?: string } | null)?.value);
  }).catch(() => null);
}

/** How past signals on this market and timeframe did (30 days), or null. Cached 10 min. */
export async function trackRecord(market: string, timeframe: string): Promise<string | null> {
  return cached(`signal-record:${market}:${timeframe}`, 10 * 60_000, async () => {
    const admin = await db();
    const since = new Date(Date.now() - RECORD_DAYS * 86_400_000).toISOString();
    const { data, error } = await admin
      .from(TABLE)
      .select("status, best_target, entered_at, feeds")
      .eq("market" as never, market)
      .eq("timeframe" as never, timeframe)
      .gte("created_at" as never, since)
      .limit(5000);
    if (error) throw new Error(error.message);
    // Market-bias calls aren't signals, so they never count.
    const rows = (
      (data ?? []) as unknown as Pick<Row, "status" | "best_target" | "entered_at" | "feeds">[]
    ).filter((r) => !r.feeds?.bias);
    return trackRecordText(
      rows.map((r) => ({ status: r.status, best_target: r.best_target, entered: !!r.entered_at })),
      RECORD_DAYS,
    );
  }).catch(() => null);
}

/* ── Messages ─────────────────────────────────────────────────────────── */

const HIGHER: Record<string, string> = {
  "1M": "1H",
  "5M": "1H",
  "15M": "4H",
  "1H": "Daily",
  "4H": "Weekly",
};

function formatter(row: Row) {
  const fmt = (n: number) => n.toFixed(row.decimals);
  const move = (from: number, to: number) => {
    const signed = (row.direction === "BUY" ? to - from : from - to) / (row.pip ?? 1);
    const size = row.pip
      ? `${Math.abs(signed).toFixed(0)} pips`
      : `${fmt(Math.abs(signed))} points`;
    return `${signed >= 0 ? "+" : "−"}${size}`;
  };
  return { fmt, move };
}

/** A signal with one take profit (all three levels on it). */
export const singleTarget = (row: Pick<Row, "tp1" | "tp3">) => Number(row.tp1) === Number(row.tp3);

/** The signal's profit lock levels, when it has the lock. */
export function lockOf(
  row: Pick<Row, "direction" | "entry" | "tp1"> & { feeds: { lock?: boolean } | null },
): { trigger: number; stop: number } | null {
  return row.feeds?.lock ? profitLock(row.direction, Number(row.entry), Number(row.tp1)) : null;
}

export function eventLine(row: Row, e: OutcomeEvent | { kind: "cancelled"; bias: string }): string {
  const { fmt, move } = formatter(row);
  const lock = lockOf(row);
  switch (e.kind) {
    case "filled":
      return `✅ I'm in at ${fmt(row.entry)}. My stop loss is at ${fmt(row.stop)}`;
    case "tp1":
      // One take profit (all three levels the same): one hit and it's done.
      if (singleTarget(row))
        return `🎯 Take profit hit (${move(row.entry, row.tp1)}). Job done, I've banked it`;
      return lock
        ? `🎯 Quick Scalp hit (${move(row.entry, row.tp1)}). I've banked some, you greedy bastard. My stop's at ${fmt(lock.stop)}, so the rest is locked in profit`
        : `🎯 Quick Scalp hit (${move(row.entry, row.tp1)}). I've banked some, you greedy bastard. My stop's now at my entry, ${fmt(row.entry)}, so this one can't lose`;
    case "tp2":
      return `🎯 Little Brave hit (${move(row.entry, row.tp2)}). Another bag secured, you jammy bastard. I'm letting the rest run to ${fmt(row.tp3)}`;
    case "tp3":
      return `🏁 Greedy Runner hit (${move(row.entry, row.tp3)}). Job fucking done, I've banked the lot`;
    case "stopped":
      return `🛑 Stopped out (${move(row.entry, row.stop)}). I've taken the fucking loss and I'm not chasing it`;
    case "breakeven":
      if (lock)
        return `🔒 It pulled back to my locked stop at ${fmt(lock.stop)}, so I'm out with ${move(row.entry, lock.stop)} banked. Better than a loss`;
      return row.best_target >= 1
        ? `⚖️ It came back to my entry after the Quick Scalp, so I'm out at breakeven. No harm done`
        : `⚖️ It came back to my entry, so I'm out at breakeven. No harm done`;
    case "protected":
      if (lock)
        return `🔒 It's 70% of the way to my take profit, so my stop's now at ${fmt(lock.stop)}, locking in ${move(row.entry, lock.stop)}. Can't lose from here`;
      return `🔒 It's moving my way, so my stop loss is now at my entry, ${fmt(row.entry)}. Can't lose from here`;
    case "unfilled":
      return `⏳ Price never came to my entry, so I've cancelled it`;
    // Only shown for a learned time stop (a plain expiry posts nothing).
    case "expired":
      return row.last_price != null
        ? `⏱ It's gone nowhere, so I'm closing it at ${fmt(row.last_price)} (${move(row.entry, row.last_price)}). Not wasting more time on it`
        : `⏱ It's gone nowhere, so I'm closing it. Not wasting more time on it`;
    case "cancelled":
      return `⚠️ The ${HIGHER[row.timeframe] ?? "higher"} trend turned ${e.bias}, so ${row.status === "pending" ? "I've cancelled it" : "I'm closing it up"}`;
  }
}

const STATUS_TEXT: Partial<Record<SignalStatus, string>> = {
  pending: "waiting for entry",
  open: "in the trade",
  tp1: "Quick Scalp hit",
  tp2: "Little Brave hit",
};

function liveLine(row: Row, price: number, now: number): string {
  const { fmt, move } = formatter(row);
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(now));
  const vsEntry = row.status === "pending" ? "" : ` (${move(row.entry, price)})`;
  return `📍 ${fmt(price)}${vsEntry} · ${STATUS_TEXT[row.status] ?? ""} · ${when}`;
}

async function senderCall<T = unknown>(
  row: Row,
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  if (row.sender_worker) {
    const w = await import("./telegram-worker.server");
    if (row.sender_worker === "trade") {
      if (row.chat_id) {
        const group = await w.managedGroup(await db(), row.chat_id);
        if (group && (!group.og_bot_present || !group.active_workers.includes("trade")))
          return null;
      }
      const res = await w.workerApi<T>(method, body);
      return res?.ok ? (res.result ?? null) : null;
    }
    const f = await import("./telegram-fleet.server");
    const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
    if (!key) return null;
    if (row.chat_id && row.chat_id < 0 && !(await f.fleetAllowed(row.sender_worker, row.chat_id)))
      return null;
    const res = await f.fleetApi<T>(row.sender_worker, method, body, key);
    return res.ok ? (res.result ?? null) : null;
  }
  const { telegramCall } = await import("./telegram-api.server");
  return telegramCall<T>(method, body);
}

const ukClock = (now: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(now));

/**
 * The card as it stands now: "I'm gonna buy … at" until the trade is in,
 * then "I've bought … at" (stop "is", "Taking profit at"); under it only the
 * latest update (each one replaces the last) and the live line while the
 * trade runs. Market-bias cards ("I'd buy") are left as they are.
 */
export function journalCard(
  card: string,
  log: string[],
  live: string | null,
  entered = false,
): string {
  const now = entered
    ? card
        .replace(
          /^(🟢|🔴) I'm gonna (buy|sell) (.+?) (?:now at|at|if it breaks (?:above|below)) ([\d.,]+)(?: on a pullback)?$/m,
          (_m, dot: string, side: string, market: string, px: string) =>
            `${dot} I've ${side === "buy" ? "bought" : "sold"} ${market} at ${px}`,
        )
        .replace(/^🛑 My stop loss will be /m, "🛑 My stop loss is ")
        .replace(/^🎯 I'll take profit at /m, "🎯 Taking profit at ")
    : card;
  const latest = log.at(-1);
  return [now, ...(latest ? ["", latest] : []), ...(live ? ["", live] : [])]
    .join("\n")
    .slice(0, 4096);
}

/** Posts an update under the signal's card; the message id, or null. */
async function sendFollowUp(row: Row, text: string): Promise<number | null> {
  if (!row.chat_id) return null;
  const { telegramCall } = await import("./telegram-api.server");
  const sent = await senderCall<{ message_id?: number }>(row, "sendMessage", {
    chat_id: row.chat_id,
    text: `📊 ${row.label} ${row.direction}\n${text}`,
    disable_web_page_preview: true,
    ...(row.message_id
      ? { reply_parameters: { message_id: row.message_id, allow_sending_without_reply: true } }
      : {}),
  });
  if (sent?.message_id) {
    const admin = await db();
    await admin.from("telegram_ephemeral_messages" as never).upsert(
      {
        chat_id: row.chat_id,
        message_id: sent.message_id,
        delete_at: new Date(Date.now() + FOLLOW_UP_TTL_MS).toISOString(),
      } as never,
      { onConflict: "chat_id,message_id" },
    );
    // In the signals chat: remembered by pair, and the results post moves under it.
    const sc = await import("./signal-chat.server");
    if (await sc.isSignalsChat(row.chat_id)) {
      await sc.trackSignalMessage(admin, row.chat_id, sent.message_id, row.market, "update");
      await sc.refreshScore(admin, row.chat_id);
    }
    // Marked as part of this signal, so the member's next signal wipes it too.
    await admin
      .from("telegram_screen_messages" as never)
      .upsert({ chat_id: row.chat_id, message_id: sent.message_id, kind: "signal" } as never, {
        onConflict: "chat_id,message_id",
      });
  }
  return sent?.message_id ?? null;
}

/**
 * A signal's entry wasn't reached: its "not reached" notice is remembered
 * (feeds.notice) and every older not-reached signal in the chat goes, card
 * and notice, so only the latest one is ever showing. Never throws.
 */
async function keepOneUnfilled(row: Row, notice: number | null) {
  if (!row.chat_id) return;
  try {
    const admin = await db();
    if (notice)
      await admin
        .from(TABLE)
        .update({ feeds: { ...row.feeds, notice } } as never)
        .eq("id" as never, row.id);
    const { data } = await admin
      .from(TABLE)
      .select("*")
      .eq("chat_id" as never, row.chat_id)
      .eq("status" as never, "unfilled")
      .neq("id" as never, row.id)
      .gte("created_at" as never, new Date(Date.now() - 48 * 3600_000).toISOString())
      .limit(50);
    for (const old of (data ?? []) as unknown as Row[]) {
      const ids = [old.message_id, Number(old.feeds?.notice) || null].filter(
        (id): id is number => !!id,
      );
      if (ids.length)
        await senderCall(old, "deleteMessages", { chat_id: row.chat_id, message_ids: ids });
      // Gone from the chat: it stops messaging it (still in the track record).
      await admin
        .from(TABLE)
        .update({ chat_id: null } as never)
        .eq("id" as never, old.id);
    }
  } catch (e) {
    console.warn("[signals] tidying older not-reached signals failed", e);
  }
}

const TARGET_NAMES = { tp1: "Quick Scalp", tp2: "Little Brave", tp3: "Greedy Runner" } as const;
const usd = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The win message: plain figures, no working shown. Null when there's nothing to say. */
export function winToastText(
  row: Pick<Row, "market" | "label" | "direction" | "entry" | "tp1" | "tp2" | "tp3" | "feeds">,
  hit: "tp1" | "tp2" | "tp3",
  lotWin: typeof import("./trade-bias").lotWin,
): { text: string; mention: { offset: number; length: number; id: number } } | null {
  const who = row.feeds?.requester;
  if (!who?.id) return null;
  const to = Number(row[hit]);
  const win = lotWin(row.market, row.direction, Number(row.entry), to);
  if (!win) return null;
  const name = (who.name || "you").slice(0, 40);
  const lead = "💰 ";
  const what = row.feeds?.bias ? "market bias call" : `${row.label} signal`;
  const text =
    `${lead}${name}, that ${what} just hit ${singleTarget(row) ? "its take profit" : `the ${TARGET_NAMES[hit]}`}! ` +
    `At 0.5 lot that's ${usd(win.profit)} in the bag. Lucky bastard.`;
  return { text, mention: { offset: lead.length, length: name.length, id: who.id } };
}

async function sendWinToast(row: Row, hit: "tp1" | "tp2" | "tp3") {
  if (!row.chat_id) return;
  const { lotWin } = await import("./trade-bias");
  const toast = winToastText(row, hit, lotWin);
  if (!toast) return;
  const sent = await senderCall<{ message_id?: number }>(row, "sendMessage", {
    chat_id: row.chat_id,
    text: toast.text,
    entities: [
      {
        type: "text_mention",
        offset: toast.mention.offset,
        length: toast.mention.length,
        user: { id: toast.mention.id },
      },
    ],
    ...(row.message_id
      ? { reply_parameters: { message_id: row.message_id, allow_sending_without_reply: true } }
      : {}),
  });
  if (sent?.message_id) {
    const admin = await db();
    await admin.from("telegram_ephemeral_messages" as never).upsert(
      {
        chat_id: row.chat_id,
        message_id: sent.message_id,
        delete_at: new Date(Date.now() + FOLLOW_UP_TTL_MS).toISOString(),
      } as never,
      { onConflict: "chat_id,message_id" },
    );
  }
}

/* ── The watcher ──────────────────────────────────────────────────────── */

function instrumentFor(row: Row): Instrument {
  return {
    label: row.label,
    code: row.market,
    asset: row.feeds.binance && !row.feeds.binance.startsWith("PAXG") ? "crypto" : "forex",
    ...(row.feeds.futures ? { futures: row.feeds.futures } : {}),
    binance: row.feeds.binance,
    kraken: row.feeds.kraken,
    yahoo: row.feeds.yahoo,
    pip: row.pip ?? undefined,
    ...(row.feeds.spot ? { spot: row.feeds.spot } : {}),
  };
}

/**
 * The gap to apply to a proxy chart (gold from PAX Gold) right now: the live
 * spot quote's gap when it's sane and within MAX_SPOT_DRIFT of the gap the
 * signal was made with, else that original gap. Pure, so it can be tested.
 */
export function liveOffset(stored: number, spotNow: number, proxyNow: number): number {
  const fresh = spotOffset(spotNow, proxyNow);
  if (!fresh || !(proxyNow > 0)) return stored;
  return Math.abs(fresh - stored) <= proxyNow * MAX_SPOT_DRIFT ? fresh : stored;
}

/** A spot gap moving more than this share of the price in one go is bad data. */
const MAX_SPOT_DRIFT = 0.003;

const opposite = (direction: Row["direction"], bias: string) =>
  (direction === "BUY" && bias === "bearish") || (direction === "SELL" && bias === "bullish");

/**
 * One pass over every active signal: new closed 1-minute candles, then
 * fills, targets, stops, trend flips and time-ups, member messages and the
 * live line. Returns counts for the cron log.
 */
/** What may be announced from the minute still forming (good news only). */
const EARLY_EVENTS = new Set(["filled", "tp1", "tp2", "tp3", "protected"]);

export async function watchSignals(now = Date.now()): Promise<{ active: number; events: number }> {
  const admin = await db();
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .in("status" as never, ACTIVE_STATUSES)
    .order("created_at" as never, { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const ctx = await import("./trade-signal-context.server");

  const byMarket = new Map<string, Row[]>();
  for (const r of rows) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r]);
  const sc0 = await import("./signal-chat.server");
  const purgedAt = await sc0.chatPurgedAt();

  let eventCount = 0;
  for (const group of byMarket.values()) {
    const inst = instrumentFor(group[0]);
    const { data: raw } = await ctx.candles(inst, "1m").catch(() => ({ data: [] }));
    // Only finished minutes, so a bar is never judged half-formed.
    const closedRaw = raw.filter((c) => c.t + MINUTE <= now);
    const trendCache = new Map<string, Promise<string | null>>();
    // Proxy charts (gold): the live spot quote, to re-check the gap each pass.
    // (Gold and bitcoin follow Vantage's own price when MetaApi's set up.)
    const brokered = ctx.BROKER_MARKETS.has(inst.code);
    const spotNow = inst.spot || brokered ? await ctx.spotPrice(inst).catch(() => NaN) : NaN;
    // Hits judged as Vantage judges them: half its spread either side of the mid.
    let half = 0;
    if (brokered) {
      const bq = await import("./broker-quotes.server");
      const model = await bq.spreadModel();
      half =
        (bq.latestSpread(model, inst.code, now) ?? bq.typicalSpread(model, inst.code, now) ?? 0) /
        2;
    }

    await Promise.all(
      group.map(async (row) => {
        // A trade from before the Boss purged the signals chat is still
        // followed (its result counts for learning) but its card is gone, so
        // it says nothing there.
        if (
          purgedAt != null &&
          Date.parse(row.created_at) < purgedAt &&
          (await sc0.isSignalsChat(row.chat_id))
        )
          row.chat_id = null;
        // Spot-adjusted signals (gold) follow the real spot price: the gap to
        // the proxy is re-measured each pass (liveOffset), the original kept
        // when the quote's missing or jumps.
        const stored = Number(row.feeds.offset) || 0;
        // (A spot-confirmed signal can start with no gap at all: the gold
        // perpetual sitting right on spot. It's re-measured all the same.)
        const offset =
          (stored || row.feeds.spot) && raw.length
            ? liveOffset(stored, spotNow, raw[raw.length - 1].c)
            : stored;
        const closed = shiftCandles(closedRaw, offset);
        const lastPrice = raw.length ? raw[raw.length - 1].c + offset : NaN;
        const created = Date.parse(row.created_at);
        // Start at the first full minute after the signal went out.
        const from = Math.floor(created / MINUTE) * MINUTE + MINUTE;
        const seen = row.last_candle_at ? Date.parse(row.last_candle_at) : -Infinity;
        const fresh = closed.filter((c) => c.t >= from && c.t > seen);
        const tracked = {
          direction: row.direction,
          entryType: (row.feeds.entry === "stop" ? "stop" : "limit") as "stop" | "limit",
          entry: Number(row.entry),
          stop: Number(row.stop),
          targets: [Number(row.tp1), Number(row.tp2), Number(row.tp3)] as [number, number, number],
          status: row.status,
          expiresAt: Date.parse(row.expires_at),
          ...(row.entered_at ? { enteredAt: Date.parse(row.entered_at) } : {}),
          // The profit lock: 70% of the way to TP1, the stop to 30% of the way.
          ...(lockOf(row)
            ? {
                beTrigger: lockOf(row)!.trigger,
                beStop: lockOf(row)!.stop,
                isProtected: !!row.feeds.protected,
              }
            : // Older signals: the learned breakeven, stop to entry once this far in profit.
              Number(row.feeds.beAt) > 0
              ? {
                  beTrigger:
                    Number(row.entry) +
                    (row.direction === "BUY" ? 1 : -1) *
                      Math.abs(Number(row.entry) - Number(row.stop)) *
                      Number(row.feeds.beAt),
                  isProtected: !!row.feeds.protected,
                }
              : {}),
        };
        // The learned time limits: fill in time, and close a trade that's gone nowhere.
        const limits = limitsFrom(row.feeds, created);
        const atBroker = brokerLevels(tracked, half);
        let result = advanceTimed(atBroker, fresh, now, limits);
        // The minute still forming: fills and profit hits are announced the
        // moment price trades there, not when the minute closes. Only that
        // good news is taken early; anything touching a stop waits for the
        // closed candle, so a wick can't call a trade off early.
        let peekedAt: number | null = null;
        const forming = shiftCandles(
          raw.filter((c) => c.t + MINUTE > now && c.t >= from && c.t > seen),
          offset,
        ).at(-1);
        if (forming && isActive(result.status)) {
          const filledNow = result.events.find((e) => e.kind === "filled")?.at;
          const peek = advanceTimed(
            {
              ...atBroker,
              status: result.status,
              ...(filledNow != null ? { enteredAt: filledNow } : {}),
            },
            [forming],
            now,
            limits,
          );
          if (peek.events.length && peek.events.every((e) => EARLY_EVENTS.has(e.kind))) {
            result = { status: peek.status, events: [...result.events, ...peek.events] };
            // That minute is done with: its closed candle isn't judged again.
            peekedAt = forming.t;
          }
        }
        let status = result.status;
        // The lock (or an older breakeven) fired: remembered with the signal,
        // and the Boss's MT5 trade gets its stop moved there too (also after a
        // runner's first take profit, where the stop moves there anyway).
        const guarded = result.events.some((e) => e.kind === "protected");
        if (guarded) row.feeds = { ...row.feeds, protected: true };
        const firstBank = !singleTarget(row) && result.events.some((e) => e.kind === "tp1");
        if ((guarded || firstBank) && row.sender_worker === "trade") {
          const { moveStopToEntry } = await import("./mt5-autotrade.server");
          await moveStopToEntry(admin, row, lockOf(row)?.stop).catch(() => undefined);
        }
        // Running out of time isn't news: the status changes, nothing is posted.
        // A learned time stop is: members are told to close it.
        const entered = result.events.find((e) => e.kind === "filled")?.at ?? tracked.enteredAt;
        const timeStopped =
          !!limits.holdMs &&
          entered != null &&
          entered + limits.holdMs < tracked.expiresAt &&
          now >= entered + limits.holdMs;
        const lines = result.events
          .filter((e) => e.kind !== "expired" || timeStopped)
          // One take profit: its hit is one line, not three; a runner's two
          // last levels are one too.
          .filter((e) => !(singleTarget(row) && (e.kind === "tp2" || e.kind === "tp3")))
          .filter((e) => !(e.kind === "tp2" && Number(row.tp2) === Number(row.tp3)))
          .map((e) =>
            eventLine(
              { ...row, last_price: Number.isFinite(lastPrice) ? lastPrice : row.last_price },
              e,
            ),
          );

        // Before TP1, a flip in the higher-timeframe trend calls the setup off.
        // Not for a market-bias call: it can lean against that trend on purpose.
        const update: Record<string, unknown> = { last_checked_at: new Date(now).toISOString() };
        const trendDue =
          !row.feeds?.bias &&
          (status === "pending" || status === "open") &&
          now - (row.last_trend_check_at ? Date.parse(row.last_trend_check_at) : created) >=
            TREND_CHECK_MS;
        if (trendDue) {
          update.last_trend_check_at = new Date(now).toISOString();
          let job = trendCache.get(row.timeframe);
          if (!job) {
            job = ctx.higherTrend(inst, row.timeframe).catch(() => null);
            trendCache.set(row.timeframe, job);
          }
          const bias = await job;
          if (bias && opposite(row.direction, bias)) {
            lines.push(eventLine({ ...row, status }, { kind: "cancelled", bias }));
            status = "cancelled";
          }
        }

        const best = Math.max(
          row.best_target,
          ...result.events.map((e) => targetsReached(e.kind as SignalStatus)),
        );
        const lastJudged = peekedAt ?? (fresh.length ? fresh[fresh.length - 1].t : null);
        if (lastJudged !== null) update.last_candle_at = new Date(lastJudged).toISOString();
        if (Number.isFinite(lastPrice)) update.last_price = lastPrice;
        if (status !== row.status) update.status = status;
        if (best !== row.best_target) update.best_target = best;
        const filled = result.events.find((e) => e.kind === "filled");
        if (filled) update.entered_at = new Date(filled.at).toISOString();
        if (!isActive(status)) update.closed_at = new Date(now).toISOString();

        // The test account: a finished trade's result goes on the balance,
        // worked out on Vantage's spread (Standard STP: no commission).
        const paper = row.feeds?.paper;
        if (paper && paper.lots > 0 && paper.pnl == null && !isActive(status)) {
          const pa = await import("./paper-account.server");
          const { SPREAD_COST } = await import("./signal-learning.server");
          const entered = !!(row.entered_at || update.entered_at);
          const pnl = pa.paperPnl(
            {
              market: row.market,
              direction: row.direction,
              entry: Number(row.entry),
              stop: Number(row.stop),
              tp1: Number(row.tp1),
              tp2: Number(row.tp2),
              tp3: Number(row.tp3),
              marketEntry: (row as { entry_type?: string }).entry_type === "market",
              entered,
              status,
              bestTarget: best,
              lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
              lockStop: lockOf(row)?.stop ?? null,
            },
            paper.lots,
            half > 0 ? half * 2 : (SPREAD_COST[row.market] ?? 0),
          );
          const state = await pa.paperState(admin);
          const before = state ? await pa.paperBalance(admin, state) : null;
          const balance = before != null ? Math.round((before + pnl) * 100) / 100 : undefined;
          row.feeds = {
            ...row.feeds,
            paper: { ...paper, pnl, ...(balance != null ? { balance } : {}) },
          };
          if (entered && balance != null) {
            const money = (n: number) =>
              `$${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            lines.push(
              `💰 Test account: ${pnl >= 0 ? "+" : "−"}${money(pnl)} on this one · balance now ${money(balance)}`,
            );
          } else update.feeds = { ...row.feeds };
        }

        // One message per trade: each update goes into the card's journal,
        // and the live line stays fresh while the trade runs.
        const log = [...(row.feeds?.log ?? []), ...lines.map((l) => `${ukClock(now)} ${l}`)];
        if (lines.length) update.feeds = { ...row.feeds, log };
        const live = isActive(status) && Number.isFinite(lastPrice);
        const editDue =
          row.card &&
          row.chat_id &&
          row.message_id &&
          (lines.length > 0 ||
            (live &&
              lastPrice !== Number(row.last_price) &&
              now - (row.last_edit_at ? Date.parse(row.last_edit_at) : 0) >= LIVE_EDIT_MS));
        let merged = false;
        if (editDue) {
          const edited = await senderCall(row, "editMessageText", {
            chat_id: row.chat_id,
            message_id: row.message_id,
            text: journalCard(
              row.card!,
              log,
              live ? liveLine({ ...row, status }, lastPrice, now) : null,
              !!(row.entered_at || update.entered_at),
            ),
            disable_web_page_preview: true,
          });
          merged = edited !== null;
          update.last_edit_at = new Date(now).toISOString();
        }

        const { error: upErr } = await admin
          .from(TABLE)
          .update(update as never)
          .eq("id" as never, row.id);
        // Into the results book: a target hit (a win) or the stop loss first (a
        // loss). Market-bias calls aren't signals, so they're never booked.
        const decided = result.events.find((e) => /^tp[123]$|^stopped$/.test(e.kind));
        if (decided && !row.feeds?.bias) {
          const { recordResult } = await import("./signal-results.server");
          await recordResult(
            admin,
            {
              ...row,
              entry: Number(row.entry),
              stop: Number(row.stop),
              tp1: Number(row.tp1),
              tp2: Number(row.tp2),
              tp3: Number(row.tp3),
            },
            best,
            result.events.some((e) => e.kind === "stopped"),
            decided.at,
          );
        }
        if (upErr) console.warn("[signals] update failed", row.id, upErr.message);
        if (lines.length) {
          eventCount += lines.length;
          // Written into the card; a separate reply only if the card couldn't be edited.
          const notice = merged ? null : await sendFollowUp(row, lines.join("\n"));
          if (merged && row.chat_id) {
            // In the signals chat the results post moves back under it.
            const sc = await import("./signal-chat.server");
            if (await sc.isSignalsChat(row.chat_id)) await sc.refreshScore(admin, row.chat_id);
          }
          // Only ever one "entry not reached" signal showing in a chat.
          if (result.events.some((e) => e.kind === "unfilled")) await keepOneUnfilled(row, notice);
        }
        // A target hit: tell whoever asked what a 1.0 lot would have paid out.
        const won = [...result.events].reverse().find((e) => /^tp[123]$/.test(e.kind));
        if (won) await sendWinToast(row, won.kind as "tp1" | "tp2" | "tp3");
      }),
    );
  }
  return { active: rows.length, events: eventCount };
}
