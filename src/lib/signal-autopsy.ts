// Why the losing signals lost (the Boss, 2026-11-15: "why did the chart
// entries let you down, was the stop too low, or did you put your stop where
// you should have placed the order?"). Pure and browser-safe.
//
// For each stopped-out signal we look at the price path before and after the
// stop, in units of the trade's risk (R = entry to stop), and sort the loss:
//
//   stop_was_entry  price went only a little past the stop (at most half a
//                   risk), turned, and reached the first target: an order AT
//                   the stop would have won. The entry belonged where the
//                   stop was.
//   stop_too_tight  price went further past the stop, then still reached the
//                   first target: right direction, not enough room.
//   gave_back       it was well in profit first (0.7 R or more), then lost:
//                   right idea, the win wasn't locked in.
//   wrong_way       none of those: the direction was wrong.

export type Candle1m = { t: number; h: number; l: number; c: number };

export const AUTOPSY_KINDS = [
  "stop_was_entry",
  "stop_too_tight",
  "gave_back",
  "wrong_way",
] as const;
export type AutopsyKind = (typeof AUTOPSY_KINDS)[number];

export const AUTOPSY_LABEL: Record<AutopsyKind, string> = {
  stop_was_entry: "Stop was where the entry should have been",
  stop_too_tight: "Stop too tight (shaken out, then it went to target)",
  gave_back: "Was winning, then gave it back",
  wrong_way: "Wrong direction",
};

/** What each kind says to change, for the Boss's lessons. */
export const AUTOPSY_LESSON: Record<AutopsyKind, string> = {
  stop_was_entry:
    "Wait for price to come to the stop zone and buy (or sell) there with a limit order: the sniper entries switch does exactly this.",
  stop_too_tight:
    "Give the stop more room beyond the swing, and size the lot down to keep the same risk.",
  gave_back:
    "Lock profit sooner: move the stop to entry or take part profit once it's 0.7 risk up.",
  wrong_way:
    "The read on direction is wrong here: test the opposite (the lab's fade strategies) and sit out these setups until it improves.",
};

/** How far past the stop still counts as "the stop was the entry", in risks. */
export const NEAR_STOP_R = 0.5;
/** Profit that should have been kept, in risks. */
export const GAVE_BACK_R = 0.7;

export type LossInput = {
  direction: "BUY" | "SELL";
  /** Levels on the chart's own price scale (a gold proxy is shifted onto it by the caller). */
  entry: number;
  stop: number;
  tp1: number;
  enteredAt: number;
  closedAt: number;
  /** How long after the stop to watch for the target (the trade's own time window). */
  lookMs: number;
  candles: Candle1m[];
};

/** Sort one stopped-out trade, or null when the levels or candles don't allow it. Pure. */
export function lossAutopsy(x: LossInput): AutopsyKind | null {
  const risk = Math.abs(x.entry - x.stop);
  if (!(risk > 0) || !x.candles.length) return null;
  const buy = x.direction === "BUY";
  // A stop on the winning side means a trailed stop (a locked profit), not a loss.
  if (buy ? x.stop >= x.entry : x.stop <= x.entry) return null;
  const inR = (p: number) => (buy ? p - x.entry : x.entry - p) / risk;
  let bestBefore = 0;
  for (const c of x.candles) {
    if (c.t < x.enteredAt || c.t > x.closedAt) continue;
    bestBefore = Math.max(bestBefore, inR(buy ? c.h : c.l));
  }
  const target = inR(x.tp1);
  let worstAfter = -1;
  let reached = false;
  for (const c of x.candles) {
    if (c.t < x.closedAt || c.t > x.closedAt + x.lookMs) continue;
    worstAfter = Math.min(worstAfter, inR(buy ? c.l : c.h));
    if (inR(buy ? c.h : c.l) >= target) {
      reached = true;
      break;
    }
  }
  if (reached) return -worstAfter - 1 <= NEAR_STOP_R ? "stop_was_entry" : "stop_too_tight";
  if (bestBefore >= GAVE_BACK_R) return "gave_back";
  return "wrong_way";
}

export type AutopsyTally = Record<AutopsyKind, number>;
export type AutopsyState = {
  v: 1;
  /** market -> strategy -> counts */
  tally: Record<string, Record<string, AutopsyTally>>;
  /** Losses already studied (closed_at of the newest one), so each is counted once. */
  doneTo: number;
  studied: number;
  updatedAt?: number;
};

export const emptyTally = (): AutopsyTally => ({
  stop_was_entry: 0,
  stop_too_tight: 0,
  gave_back: 0,
  wrong_way: 0,
});

/** A stored autopsy state, repaired. Pure. */
export function cleanAutopsy(raw: unknown): AutopsyState {
  const src = (raw ?? {}) as Partial<AutopsyState>;
  const out: AutopsyState = {
    v: 1,
    tally: {},
    doneTo: Number.isFinite(src.doneTo) ? Number(src.doneTo) : 0,
    studied: Number.isFinite(src.studied) ? Number(src.studied) : 0,
    updatedAt: Number.isFinite(src.updatedAt) ? Number(src.updatedAt) : undefined,
  };
  for (const [m, byStrat] of Object.entries(src.tally ?? {})) {
    if (!/^[A-Z]{3,10}$/.test(m) || !byStrat || typeof byStrat !== "object") continue;
    for (const [s, t] of Object.entries(byStrat)) {
      if (!/^[a-z0-9_]{1,40}$/i.test(s)) continue;
      const row = emptyTally();
      for (const k of AUTOPSY_KINDS) {
        const n = Number((t as Record<string, unknown>)?.[k]);
        row[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      }
      (out.tally[m] ??= {})[s] = row;
    }
  }
  return out;
}

export type AutopsyRow = {
  market: string;
  strategy: string;
  losses: number;
  counts: AutopsyTally;
  main: AutopsyKind;
  /** Share of the losses that are the main kind, 0-100. */
  mainShare: number;
  lesson: string;
};

/** Each market and strategy's losses, biggest first, with the main reason and its lesson. Pure. */
export function autopsyBoard(state: AutopsyState): AutopsyRow[] {
  const rows: AutopsyRow[] = [];
  for (const [market, byStrat] of Object.entries(state.tally))
    for (const [strategy, counts] of Object.entries(byStrat)) {
      const losses = AUTOPSY_KINDS.reduce((a, k) => a + counts[k], 0);
      if (!losses) continue;
      const main = [...AUTOPSY_KINDS].sort((a, b) => counts[b] - counts[a])[0];
      rows.push({
        market,
        strategy,
        losses,
        counts,
        main,
        mainShare: Math.round((100 * counts[main]) / losses),
        lesson: AUTOPSY_LESSON[main],
      });
    }
  return rows.sort((a, b) => b.losses - a.losses);
}
