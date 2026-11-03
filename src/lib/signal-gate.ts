// The signals bot only posts what's most likely to win (the Boss, 2026-11-03:
// "make any tweaks to signal bot in terms of accuracy"; the Copy Trader B0T
// copies every signal it posts). Just before an automatic alert goes out
// (postOnce's gate), postDecision holds it back when its record says it's a
// loser: its confidence band, its strategy or its chart has been losing, it's
// under 70% without a winning record, or the last three lost and it's under
// 80%. A held-back alert is followed silently as a shadow trade
// ("losing_record"), so learning still sees it. Records come from posted
// signals over 60 days, so a blocked strategy or chart gets another go once
// its losing trades age out of that window.
import { RANDOM_MIN_TRADES, type StrategyStats } from "./signal-random.server";

/** Alerts under this need a winning record at their confidence to be posted. */
export const POST_MIN_CONFIDENCE = 70;
/** After this many losses in a row it only posts the surest alerts (POST_COOL_CONFIDENCE). */
export const POST_COOL_STREAK = 3;
export const POST_COOL_CONFIDENCE = 80;
/** Settled calls needed before a record (edge, strategy, chart) can rule a trade out. */
export const POST_MIN_RECORD = 8;

export type PostInputs = {
  confidencePct: number;
  /** Average result in risks of recent settled calls at this confidence, and how many. */
  edge?: number | null;
  edgeTrades?: number;
  /** The signals' losses in a row (the demo account's, which copies them all), newest first. */
  lossStreak?: number;
  /** The record of the strategy and the chart this alert came from. */
  strategy?: StrategyStats;
  chart?: StrategyStats;
  /** Names for the reason line. */
  strategyName?: string;
  chartName?: string;
};

const losing = (s: StrategyStats | undefined, min: number) => !!s && s.n >= min && s.sumR < 0;

/** Whether the signals bot posts this alert, and why not. Pure. */
export function postDecision(o: PostInputs): { post: true } | { post: false; why: string } {
  const sure = o.confidencePct;
  const proven =
    o.edge != null && Number.isFinite(o.edge) && (o.edgeTrades ?? 0) >= POST_MIN_RECORD;
  if (proven && o.edge! < 0)
    return { post: false, why: `calls at ${sure}% have been losing lately` };
  if (sure < POST_MIN_CONFIDENCE && !(proven && o.edge! > 0))
    return { post: false, why: `only ${sure}% sure` };
  if (losing(o.strategy, RANDOM_MIN_TRADES))
    return { post: false, why: `${o.strategyName ?? "this strategy"} has been losing` };
  if (losing(o.chart, RANDOM_MIN_TRADES))
    return { post: false, why: `the ${o.chartName ?? "chart"} has been losing` };
  if ((o.lossStreak ?? 0) >= POST_COOL_STREAK && sure < POST_COOL_CONFIDENCE)
    return {
      post: false,
      why: `${o.lossStreak} losses in a row, so only ${POST_COOL_CONFIDENCE}%+ until it wins again`,
    };
  return { post: true };
}
