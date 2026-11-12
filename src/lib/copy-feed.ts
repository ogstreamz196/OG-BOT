// The copy feed (the Boss, 2026-11-10): a read-only list of the OG Trade
// Bot's signals in the signals chat, with the level the bot would close at
// right now, for the Boss's own Python copier (tools/mt5-copier) running next
// to MT5 on a Windows PC. The copier opens at market when a signal fills,
// closes half when TP1 is banked on a runner, and closes the rest at market
// when the signal is over (no stop or take profit sits on the broker: the
// house rule). Pure, so it can be tested.
import { profitLock } from "./trade-signal-outcome";

export type CopyFeedRow = {
  id: string;
  market: string;
  direction: "BUY" | "SELL";
  entry: number | string;
  stop: number | string;
  tp1: number | string;
  tp3: number | string;
  status: string;
  best_target: number | null;
  entered_at: string | null;
  closed_at: string | null;
  created_at: string;
  confidence_pct: number | null;
  feeds: {
    bias?: unknown;
    lock?: boolean;
    protected?: boolean;
    tp0?: number;
    trail?: { stop?: number | null } | null;
    paper?: { lots?: number } | null;
    /** A counter-trend hedge: the copier keeps it as its own MT5 ticket. */
    hedge?: boolean;
    /** "stop" for a break entry; limit/market are told apart by the status. */
    entry?: unknown;
  } | null;
};

export type CopySignal = {
  id: string;
  market: string;
  direction: "BUY" | "SELL";
  status: string;
  /** Still running: pending (not filled yet), open, or a target banked and the rest running. */
  active: boolean;
  /** Filled: the copier may be in it. */
  filled: boolean;
  entry: number;
  /** Where the bot's stop is now (trailing stop, profit lock or the original stop). */
  stopNow: number;
  tp1: number;
  /** The far target (a runner's cap; the same as tp1 for a one-target trade). */
  tp3: number;
  /** TP1 was banked on a runner: half is closed, the rest runs. */
  halfClosed: boolean;
  /** The lot the bot's test account took on this trade, or null. */
  lots: number | null;
  /** A counter-trend hedge: the copier keeps it as its own ticket (MT5 hedging). */
  hedge: boolean;
  /** How the bot entered: "stop" (break), "limit" (pullback/sniper) or "market". */
  entryType: "market" | "limit" | "stop";
  confidence: number | null;
  createdAt: string;
  closedAt: string | null;
};

const ACTIVE = new Set(["pending", "open", "tp1", "tp2"]);
const FILLED = new Set(["open", "tp1", "tp2", "tp3", "stopped", "breakeven"]);

/** One feed entry from a trade_signals row. Pure. */
export function copySignal(row: CopyFeedRow): CopySignal {
  const entry = Number(row.entry);
  const tp1 = Number(row.tp1);
  const tp3 = Number(row.tp3);
  const best = Number(row.best_target) || 0;
  const runner = tp1 !== tp3;
  const trail = row.feeds?.trail?.stop;
  const lock = row.feeds?.lock
    ? profitLock(row.direction, entry, Number(row.feeds.tp0 ?? tp1))
    : null;
  let stopNow = Number(row.stop);
  if (trail != null && Number.isFinite(Number(trail))) stopNow = Number(trail);
  else if (row.feeds?.protected || best >= 1) stopNow = lock?.stop ?? entry;
  return {
    id: row.id,
    market: row.market,
    direction: row.direction,
    status: row.status,
    active: ACTIVE.has(row.status),
    filled: !!row.entered_at || FILLED.has(row.status),
    entry,
    stopNow,
    tp1,
    tp3,
    halfClosed: runner && best >= 1,
    lots: Number(row.feeds?.paper?.lots) > 0 ? Number(row.feeds!.paper!.lots) : null,
    hedge: !!row.feeds?.hedge,
    entryType: row.feeds?.entry === "stop" ? "stop" : row.status === "pending" ? "limit" : "market",
    confidence: row.confidence_pct,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

/** The feed: market-bias calls left out, newest first. Pure. */
export function copyFeed(rows: CopyFeedRow[]): CopySignal[] {
  return rows
    .filter((r) => !r.feeds?.bias)
    .map(copySignal)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * A test signal for the copier only (site_content "copy.testSignal", JSON),
 * so the Boss can check the copier on a demo without anything going to
 * Telegram or the trade records. Shown until `until` (ms). Fields:
 * { id, market, direction, status, halfClosed?, lots?, createdAt, until }. The stop
 * is out of reach, so only the status (or the test ending) closes it. Pure.
 */
export function testSignal(value: string | null | undefined, now: number): CopySignal | null {
  if (!value) return null;
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(value);
  } catch {
    return null;
  }
  const until = Number(t.until);
  const direction = t.direction === "SELL" ? "SELL" : "BUY";
  const market = String(t.market ?? "");
  const createdAt = String(t.createdAt ?? "");
  if (!(until > now) || !market || !Number.isFinite(Date.parse(createdAt))) return null;
  const status = String(t.status ?? "open");
  return {
    id: `test-${String(t.id ?? "1")}`,
    market,
    direction,
    status,
    active: ACTIVE.has(status),
    filled: status !== "pending",
    entry: 0,
    stopNow: direction === "BUY" ? 0 : 1e12,
    tp1: 0,
    tp3: 0,
    halfClosed: !!t.halfClosed,
    lots: Number(t.lots) > 0 ? Number(t.lots) : null,
    hedge: !!t.hedge,
    entryType: "market",
    confidence: null,
    createdAt,
    closedAt: null,
  };
}

/** The copiers' remote settings (site_content "copy.settings"), as the feed sends them. */
/** Risk multipliers offered: -4x, -2x, 1x, 2x, 4x, 10x. (Kept for back-compat / typed commands.) */
export const MULTIPLIERS = [0.25, 0.5, 1, 2, 4, 10];
export const multLabel = (m: number) => (m < 1 ? `-${Math.round(1 / m)}x` : `${m}x`);

/**
 * Lot-size bands (the Boss, 2026-11-12: clearer than "same as the bot" plus a
 * multiplier). The copier takes a lot inside the chosen band, bigger the surer
 * the signal is. Low/medium/high overlap on purpose, the way the bot's own lot
 * does. Replaces the lot/multiplier controls on the settings card.
 */
export const LOT_BANDS = {
  small: [0.01, 0.05],
  medium: [0.02, 0.1],
  large: [0.1, 0.5],
} as const;
export type LotBand = keyof typeof LOT_BANDS;
export const LOT_BAND_ORDER: LotBand[] = ["small", "medium", "large"];
export const lotBandLabel = (b: LotBand) => `${LOT_BANDS[b][0]} – ${LOT_BANDS[b][1]}`;

/** The lot within a band, bigger the surer the signal (confidence 55–90%). Pure. */
export function lotForBand(band: LotBand, confidence?: number | null): number {
  const [lo, hi] = LOT_BANDS[band];
  const c = Number(confidence);
  const t = Number.isFinite(c) ? Math.min(1, Math.max(0, (c - 55) / 35)) : 0;
  return Math.round((lo + (hi - lo) * t) * 100) / 100;
}

export type CopySettings = {
  /** No new trades; open ones are still managed and closed. */
  paused?: boolean;
  /** The lot-size band the copier scales within (the card's lot control). */
  lotBand?: LotBand;
  /** "bot" (the Copy Trader B0T's lot) or a fixed lot. Back-compat / typed commands. */
  lot?: "bot" | number;
  markets?: string[];
  maxOpen?: number;
  maxLateMinutes?: number;
  useBrokerStop?: boolean;
  /** Lot multiplier on every copied trade (0.25 to 10). */
  multiplier?: number;
  /** High-frequency mode: faster checks and more trades open at once. */
  hft?: boolean;
};

/**
 * Remote settings for every copier (the Boss, 2026-11-11: settings editable
 * without touching the laptop). Only valid keys get through; anything missing
 * leaves the copier's own config.ini value. Pure.
 */
export function copySettings(value: string | null | undefined): CopySettings {
  if (!value) return {};
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(value);
  } catch {
    return {};
  }
  if (!t || typeof t !== "object") return {};
  const out: CopySettings = {};
  if (typeof t.paused === "boolean") out.paused = t.paused;
  if (LOT_BAND_ORDER.includes(t.lotBand as LotBand)) out.lotBand = t.lotBand as LotBand;
  if (t.lot === "bot") out.lot = "bot";
  else if (Number(t.lot) >= 0.01 && Number(t.lot) <= 5)
    out.lot = Math.round(Number(t.lot) * 100) / 100;
  if (Array.isArray(t.markets)) {
    const m = t.markets.map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{3,10}$/.test(x));
    out.markets = [...new Set(m)];
  }
  const int = (v: unknown, lo: number, hi: number) =>
    Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : undefined;
  if (t.maxOpen != null) out.maxOpen = int(t.maxOpen, 0, 50);
  if (t.maxLateMinutes != null) out.maxLateMinutes = int(t.maxLateMinutes, 1, 120);
  if (typeof t.useBrokerStop === "boolean") out.useBrokerStop = t.useBrokerStop;
  if (MULTIPLIERS.includes(Number(t.multiplier))) out.multiplier = Number(t.multiplier);
  if (typeof t.hft === "boolean") out.hft = t.hft;
  for (const k of Object.keys(out) as (keyof CopySettings)[])
    if (out[k] === undefined) delete out[k];
  return out;
}
