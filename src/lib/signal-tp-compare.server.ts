// The take profit question (the Boss's, 2026-11-03): signals post a take
// profit about two thirds of the stop's distance, so a strategy can win most
// of its trades and still lose money. This replays the learning loop's stored
// setups (signal_learn_samples) with the take profit at other multiples of
// the stop (1:1, 1.25:1 ...) under the market's current learned setting, the
// spread and the profit lock, so the Boss can see which would have banked
// more. Read only: it never changes a setting or a live signal, and it never
// writes or deletes a stored row.
import { applyTuning, evaluate, learnedTuning, SPREAD_COST } from "./signal-learning.server";
import { SAMPLE_VERSION, LEARN_DAYS } from "./signal-samples.server";
import { usdPerLotMove } from "./trade-bias";
import type { LearnSample } from "./trade-signal-backtest";
import type { Tuning } from "./trade-signal";

type Admin = any;

/** The take profits tried, as a multiple of the stop's distance. */
export const TP_RATIOS = [0.75, 1, 1.25, 1.5, 2] as const;
/** The lot the dollars are shown at (the demo trades 0.05 to 0.3). */
export const COMPARE_LOT = 0.1;
/** Fewer trades than this and a comparison isn't worth reading. */
export const COMPARE_MIN_TRADES = 20;

export type TargetRow = {
  /** null = the target signals use now. */
  ratio: number | null;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  sumR: number;
  /** Dollars at COMPARE_LOT, after the spread. */
  cash: number;
};

export type TargetComparison = {
  market: string;
  days: number;
  /** The take profit signals use now, as a multiple of the stop (the median). */
  currentRatio: number | null;
  rows: TargetRow[];
  /** The best row by dollars, when there are enough trades to say. */
  best: number | null | undefined;
  lot: number;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One target tried on every setup: each trade on its own, so dollars follow each trade's size. */
function tryTarget(
  samples: LearnSample[],
  tune: Tuning,
  market: string,
  lots: number,
  ratio: number | null,
): TargetRow {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let sumR = 0;
  let cash = 0;
  for (const s of samples) {
    const e = evaluate([s], tune, ratio ?? undefined);
    if (!e.n) continue;
    n += e.n;
    wins += e.wins;
    losses += e.losses;
    sumR += e.sumR;
    const per = usdPerLotMove(market, s.entry) ?? 0;
    cash += e.sumR * s.raw.risk * per * lots;
  }
  const decided = wins + losses;
  return {
    ratio,
    n,
    wins,
    losses,
    winRate: decided ? wins / decided : 0,
    sumR: Math.round(sumR * 100) / 100,
    cash: Math.round(cash * 100) / 100,
  };
}

/**
 * The target signals use now against each of TP_RATIOS on the same setups.
 * Pure (the samples carry their own spread in `cost`).
 */
export function compareTargets(
  samples: LearnSample[],
  tune: Tuning,
  market: string,
  lots = COMPARE_LOT,
  days = 0,
): TargetComparison {
  const ratios: number[] = [];
  for (const s of samples) {
    if (s.verdict !== "trade" || s.confidencePct < tune.minConfidence || !(s.raw.risk > 0))
      continue;
    // The ratio the engine's own take profit has on this setup.
    const one = evaluate([s], tune);
    if (!one.n) continue;
    const { entry, stop, targets } = applyTuning(s, tune);
    const risk = Math.abs(entry - stop);
    if (risk > 0) ratios.push(Math.abs(targets[0] - entry) / risk);
  }
  const rows = [null, ...TP_RATIOS].map((r) => tryTarget(samples, tune, market, lots, r));
  const enough = rows.filter((r) => r.n >= COMPARE_MIN_TRADES);
  const best = enough.length ? enough.reduce((a, b) => (b.cash > a.cash ? b : a)).ratio : undefined;
  const cur = median(ratios);
  return {
    market,
    days,
    currentRatio: cur == null ? null : Math.round(cur * 100) / 100,
    rows,
    best,
    lot: lots,
  };
}

/** The stored setups for a market, the last LEARN_DAYS (read only). */
async function storedSamples(admin: Admin, market: string, now: number): Promise<LearnSample[]> {
  const out: LearnSample[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await admin
      .from("signal_learn_samples")
      .select("sample")
      .eq("market", market)
      .eq("version", SAMPLE_VERSION)
      .gte("t", now - LEARN_DAYS * 86_400_000)
      .order("t", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) break;
    const rows = (data ?? []) as { sample: LearnSample }[];
    for (const r of rows) out.push(r.sample);
    if (rows.length < 1000) break;
  }
  return out;
}

/** The comparison for a market from what's stored, with Vantage's spread. Null when nothing's stored. */
export async function targetComparison(
  admin: Admin,
  market: string,
  now = Date.now(),
): Promise<TargetComparison | null> {
  const samples = await storedSamples(admin, market, now);
  if (!samples.length) return null;
  const bq = await import("./broker-quotes.server");
  const [model, fee, tune] = await Promise.all([
    bq.spreadModel(),
    bq.commissionPrice(market),
    learnedTuning(market, now),
  ]);
  const fallback = SPREAD_COST[market] ?? 0;
  for (const s of samples) {
    s.cost = bq.typicalSpread(model, market, s.t) ?? fallback;
    s.fee = fee;
  }
  const days = Math.max(1, Math.round((samples.at(-1)!.t - samples[0].t) / 86_400_000));
  return compareTargets(samples, tune, market, COMPARE_LOT, days);
}
