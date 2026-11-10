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
