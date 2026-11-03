// The Copy Trader B0T is choosy (the Boss's ask, 2026-11-03: "keep improving
// the successful trades rate" while everyone watches the live test). The
// trade bot still posts every alert and the signals keep learning from all of
// them; the copy bot decides BEFORE each entry whether it copies the trade,
// the way a real copy trader picks which signals to follow. A trade it sits
// out has no lot (lots 0), so it's never in its balance, win rate or
// "copying now" lines either way: nothing is decided after the result.
import { RANDOM_MIN_TRADES, type StrategyStats } from "./signal-random.server";

/** The copy bot only copies alerts at least this sure, unless calls like it have been winning. */
export const COPY_MIN_CONFIDENCE = 70;
/** After this many losses in a row it only copies the surest alerts (COPY_COOL_CONFIDENCE). */
export const COPY_COOL_STREAK = 3;
export const COPY_COOL_CONFIDENCE = 80;
/** Settled calls needed before a record (edge, strategy, chart) can rule a trade out. */
export const COPY_MIN_RECORD = 8;

export type CopyInputs = {
  confidencePct: number;
  /** Average result in risks of recent settled calls at this confidence, and how many. */
  edge?: number | null;
  edgeTrades?: number;
  /** The copy bot's losses in a row, newest first. */
  lossStreak?: number;
  /** The record of the strategy and the chart this alert came from. */
  strategy?: StrategyStats;
  chart?: StrategyStats;
  /** Names for the reason line. */
  strategyName?: string;
  chartName?: string;
};

const losing = (s: StrategyStats | undefined, min: number) => !!s && s.n >= min && s.sumR < 0;

/** Whether the copy bot copies this alert, and why not. Pure. */
export function copyDecision(o: CopyInputs): { copy: true } | { copy: false; why: string } {
  const sure = o.confidencePct;
  const proven =
    o.edge != null && Number.isFinite(o.edge) && (o.edgeTrades ?? 0) >= COPY_MIN_RECORD;
  if (proven && o.edge! < 0)
    return { copy: false, why: `calls at ${sure}% have been losing lately` };
  if (sure < COPY_MIN_CONFIDENCE && !(proven && o.edge! > 0))
    return { copy: false, why: `only ${sure}% sure` };
  if (losing(o.strategy, RANDOM_MIN_TRADES))
    return { copy: false, why: `${o.strategyName ?? "this strategy"} has been losing` };
  if (losing(o.chart, RANDOM_MIN_TRADES))
    return { copy: false, why: `the ${o.chartName ?? "chart"} has been losing` };
  if ((o.lossStreak ?? 0) >= COPY_COOL_STREAK && sure < COPY_COOL_CONFIDENCE)
    return {
      copy: false,
      why: `${o.lossStreak} losses in a row, so only ${COPY_COOL_CONFIDENCE}%+ until it wins again`,
    };
  return { copy: true };
}
