// Follows every Telegram trade signal after it's sent: records it, checks
// the price every minute (cron → /api/public/trade-signal-watch), tells the
// member when the entry fills, a target or the stop is hit, the higher
// timeframe trend turns against it or time runs out, keeps a live price line
// on the signal card, and builds the honest track record shown on new
// signals. Outcome rules live in trade-signal-outcome.ts.
import type { Instrument } from "./trade-signal";
import type { SignalFeeds, SignalPlan } from "./trade-signal-context.server";
import { backtestKey, parseSavedBacktest, type SavedBacktest } from "./trade-signal-backtest";
import { shiftCandles } from "./trade-signal-extras";
import {
  ACTIVE_STATUSES,
  advanceSignal,
  isActive,
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
      .select("status, best_target, entered_at")
      .eq("market" as never, market)
      .eq("timeframe" as never, timeframe)
      .gte("created_at" as never, since)
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Pick<Row, "status" | "best_target" | "entered_at">[];
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

export function eventLine(row: Row, e: OutcomeEvent | { kind: "cancelled"; bias: string }): string {
  const { fmt, move } = formatter(row);
  switch (e.kind) {
    case "filled":
      return `✅ Filled at ${fmt(row.entry)} · Cut The Bleed at ${fmt(row.stop)}`;
    case "tp1":
      return `🎯 Quick Scalp hit (${move(row.entry, row.tp1)}) · bank it, you greedy bastard. Move your stop to ${fmt(row.entry)}`;
    case "tp2":
      return `🎯 Potentially hit (${move(row.entry, row.tp2)}) · another bag secured, you jammy bastard. Greedy Runner next at ${fmt(row.tp3)}`;
    case "tp3":
      return `🏁 Greedy Runner hit (${move(row.entry, row.tp3)}) · job fucking done. Bank it, don't get cocky`;
    case "stopped":
      return `🛑 Bled out at the stop (${move(row.entry, row.stop)}) · cut the fucking loss. Don't chase it`;
    case "breakeven":
      return `⚖️ Back to entry after the Quick Scalp · closed at breakeven`;
    case "unfilled":
      return `⏳ Entry not reached in time · cancel the order`;
    case "expired":
      return row.last_price != null
        ? `⏳ Time's up · price ${fmt(row.last_price)} (${move(row.entry, row.last_price)})`
        : `⏳ Time's up on this signal`;
    case "cancelled":
      return `⚠️ ${HIGHER[row.timeframe] ?? "Higher"} trend turned ${e.bias} · ${row.status === "pending" ? "cancel the order" : "close it or tighten your stop"}`;
  }
}

const STATUS_TEXT: Partial<Record<SignalStatus, string>> = {
  pending: "waiting for entry",
  open: "in the trade",
  tp1: "Quick Scalp hit",
  tp2: "Potentially hit",
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

async function senderCall<T = unknown>(row: Row, method: string, body: Record<string, unknown>): Promise<T | null> {
  if (row.sender_worker) {
    const w = await import("./telegram-worker.server");
    if (row.sender_worker === "trade") {
      if (row.chat_id && !(await w.workerAllowed(await db(), row.chat_id, "trade"))) return null;
      const res = await w.workerApi<T>(method, body);
      return res?.ok ? res.result ?? null : null;
    }
    const f = await import("./telegram-fleet.server");
    const key = process.env['TELEGRAM_CREDENTIAL_KEY'];
    if (!key) return null;
    if (row.chat_id && row.chat_id < 0 && !await f.fleetAllowed(row.sender_worker, row.chat_id)) return null;
    const res = await f.fleetApi<T>(row.sender_worker, method, body, key);
    return res.ok ? res.result ?? null : null;
  }
  const {telegramCall} = await import("./telegram-api.server");
  return telegramCall<T>(method, body);
}

async function sendFollowUp(row: Row, text: string) {
  if (!row.chat_id) return;
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
    // Marked as part of this signal, so the member's next signal wipes it too.
    await admin
      .from("telegram_screen_messages" as never)
      .upsert({ chat_id: row.chat_id, message_id: sent.message_id, kind: "signal" } as never, {
        onConflict: "chat_id,message_id",
      });
  }
}

/* ── The watcher ──────────────────────────────────────────────────────── */

function instrumentFor(row: Row): Instrument {
  return {
    label: row.label,
    code: row.market,
    asset: row.feeds.binance && !row.feeds.binance.startsWith("PAXG") ? "crypto" : "forex",
    binance: row.feeds.binance,
    kraken: row.feeds.kraken,
    yahoo: row.feeds.yahoo,
    pip: row.pip ?? undefined,
  };
}

const opposite = (direction: Row["direction"], bias: string) =>
  (direction === "BUY" && bias === "bearish") || (direction === "SELL" && bias === "bullish");

/**
 * One pass over every active signal: new closed 1-minute candles, then
 * fills, targets, stops, trend flips and time-ups, member messages and the
 * live line. Returns counts for the cron log.
 */
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

  let eventCount = 0;
  for (const group of byMarket.values()) {
    const inst = instrumentFor(group[0]);
    const { data: raw } = await ctx.candles(inst, "1m").catch(() => ({ data: [] }));
    // Only finished minutes, so a bar is never judged half-formed.
    const closedRaw = raw.filter((c) => c.t + MINUTE <= now);
    const trendCache = new Map<string, Promise<string | null>>();

    await Promise.all(
      group.map(async (row) => {
        // Spot-adjusted signals (gold) follow the same shifted chart they were made from.
        const offset = Number(row.feeds.offset) || 0;
        const closed = shiftCandles(closedRaw, offset);
        const lastPrice = raw.length ? raw[raw.length - 1].c + offset : NaN;
        const created = Date.parse(row.created_at);
        // Start at the first full minute after the signal went out.
        const from = Math.floor(created / MINUTE) * MINUTE + MINUTE;
        const seen = row.last_candle_at ? Date.parse(row.last_candle_at) : -Infinity;
        const fresh = closed.filter((c) => c.t >= from && c.t > seen);
        const result = advanceSignal(
          {
            direction: row.direction,
            entryType: row.feeds.entry === "stop" ? "stop" : "limit",
            entry: Number(row.entry),
            stop: Number(row.stop),
            targets: [Number(row.tp1), Number(row.tp2), Number(row.tp3)],
            status: row.status,
            expiresAt: Date.parse(row.expires_at),
          },
          fresh,
          now,
        );
        let status = result.status;
        const lines = result.events.map((e) =>
          eventLine(
            { ...row, last_price: Number.isFinite(lastPrice) ? lastPrice : row.last_price },
            e,
          ),
        );

        // Before TP1, a flip in the higher-timeframe trend calls the setup off.
        const update: Record<string, unknown> = { last_checked_at: new Date(now).toISOString() };
        const trendDue =
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
        if (fresh.length) update.last_candle_at = new Date(fresh[fresh.length - 1].t).toISOString();
        if (Number.isFinite(lastPrice)) update.last_price = lastPrice;
        if (status !== row.status) update.status = status;
        if (best !== row.best_target) update.best_target = best;
        const filled = result.events.find((e) => e.kind === "filled");
        if (filled) update.entered_at = new Date(filled.at).toISOString();
        if (!isActive(status)) update.closed_at = new Date(now).toISOString();

        // Keep the card's live line fresh while the signal runs.
        const editDue =
          isActive(status) &&
          row.card &&
          row.chat_id &&
          row.message_id &&
          Number.isFinite(lastPrice) &&
          (lines.length > 0 ||
            (lastPrice !== Number(row.last_price) &&
              now - (row.last_edit_at ? Date.parse(row.last_edit_at) : 0) >= LIVE_EDIT_MS));
        if (editDue) {
          const { telegramCall } = await import("./telegram-api.server");
          await senderCall(row, "editMessageText", {
            chat_id: row.chat_id,
            message_id: row.message_id,
            text: `${row.card}\n\n${liveLine({ ...row, status }, lastPrice, now)}`,
            disable_web_page_preview: true,
          });
          update.last_edit_at = new Date(now).toISOString();
        }

        const { error: upErr } = await admin
          .from(TABLE)
          .update(update as never)
          .eq("id" as never, row.id);
        if (upErr) console.warn("[signals] update failed", row.id, upErr.message);
        if (lines.length) {
          eventCount += lines.length;
          await sendFollowUp(row, lines.join("\n"));
        }
      }),
    );
  }
  return { active: rows.length, events: eventCount };
}
