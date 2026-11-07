// The signals bot only posts what's most likely to win (the Boss, 2026-11-03:
// "make any tweaks to signal bot in terms of accuracy"; the Copy Trader B0T
// copies every signal it posts). Just before an automatic alert goes out
// (postOnce's gate), postDecision holds it back when its record says it's a
// loser: its confidence band, its strategy or its chart has been clearly
// losing (POST_BAD_EDGE), or it's under 70% without a winning record. If
// nothing has been posted for POST_QUIET_MIN, the next alert goes out anyway. A held-back alert is followed silently as a shadow trade
// ("losing_record"), so learning still sees it. Records come from posted
// signals over 60 days, so a blocked strategy or chart gets another go once
// its losing trades age out of that window.
import { RANDOM_MIN_TRADES, type StrategyStats } from "./signal-random.server";
import type { GateConfig } from "./engine-config";

/** Alerts under this need a winning record at their confidence to be posted. */
export const POST_MIN_CONFIDENCE = 70;
/** Settled calls needed before a record (edge, strategy, chart) can rule a trade out. */
export const POST_MIN_RECORD = 8;
/**
 * A record only rules alerts out when it's clearly losing: an average of
 * this many risks per trade or worse. A small average loss isn't enough
 * (with the take profit inside the stop, a decent win rate can still average
 * a little under zero), or nearly everything would be held back.
 */
export const POST_BAD_EDGE = -0.3;
/**
 * A confidence band that wins this rarely is held back, even when its average
 * R isn't terrible (a few big runners can prop up a low win rate). Needs at
 * least POST_MIN_WINRATE_TRADES decided calls first.
 */
export const POST_MIN_WINRATE = 0.42;
export const POST_MIN_WINRATE_TRADES = 12;

/**
 * The safety valve (2026-11-03, after the gate held back everything for
 * hours): when nothing has been posted for this long, the next alert goes
 * out whatever its record, so the chat never goes quiet and the records
 * keep getting fresh trades to learn from.
 */
export const POST_QUIET_MIN = 30;

export type PostInputs = {
  confidencePct: number;
  /** Average result in risks of recent settled calls at this confidence, and how many. */
  edge?: number | null;
  edgeTrades?: number;
  /** The real win rate (0..1) of those calls, and how many were decided (won or lost). */
  winRate?: number | null;
  winRateTrades?: number;
  /** The record of the strategy and the chart this alert came from. */
  strategy?: StrategyStats;
  chart?: StrategyStats;
  /** Names for the reason line. */
  strategyName?: string;
  chartName?: string;
  /** Minutes since the signals bot last posted anything (null: never or unknown). */
  minutesSinceLastPost?: number | null;
};

/** The gate's thresholds, defaulting to the constants above. The Boss can
 * override them from TradeTweaker (engine-config); unset = these values. */
export const GATE_DEFAULTS: GateConfig = {
  minConfidence: POST_MIN_CONFIDENCE,
  minRecord: POST_MIN_RECORD,
  badEdge: POST_BAD_EDGE,
  minWinRate: POST_MIN_WINRATE,
  minWinRateTrades: POST_MIN_WINRATE_TRADES,
  quietMin: POST_QUIET_MIN,
};

const clearlyLosing = (s: StrategyStats | undefined, badEdge: number) =>
  !!s && s.n >= RANDOM_MIN_TRADES && s.sumR / s.n <= badEdge;

/** Whether the signals bot posts this alert, and why not. Pure. */
export function postDecision(
  o: PostInputs,
  cfg: GateConfig = GATE_DEFAULTS,
): { post: true } | { post: false; why: string } {
  // Quiet for a while: post, so the chat (and the learning) never stalls.
  if (o.minutesSinceLastPost == null || o.minutesSinceLastPost >= cfg.quietMin)
    return { post: true };
  const sure = o.confidencePct;
  const proven = o.edge != null && Number.isFinite(o.edge) && (o.edgeTrades ?? 0) >= cfg.minRecord;
  if (proven && o.edge! <= cfg.badEdge)
    return { post: false, why: `calls at ${sure}% have been losing lately` };
  // A band that wins too rarely is held back even if its average R scrapes by.
  if (
    o.winRate != null &&
    Number.isFinite(o.winRate) &&
    (o.winRateTrades ?? 0) >= cfg.minWinRateTrades &&
    o.winRate < cfg.minWinRate
  )
    return {
      post: false,
      why: `calls at ${sure}% win only ${Math.round(o.winRate * 100)}% of the time`,
    };
  if (sure < cfg.minConfidence && !(proven && o.edge! > 0))
    return { post: false, why: `only ${sure}% sure` };
  if (clearlyLosing(o.strategy, cfg.badEdge))
    return { post: false, why: `${o.strategyName ?? "this strategy"} has been losing` };
  if (clearlyLosing(o.chart, cfg.badEdge))
    return { post: false, why: `the ${o.chartName ?? "chart"} has been losing` };
  return { post: true };
}
