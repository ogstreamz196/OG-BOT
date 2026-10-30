// Pair-specific checks, on live trial: what really drives each market, read
// alongside the chart engine.
//
// Gold: the US dollar and US yields. Gold usually moves against both, so a
// gold buy while the dollar surges (EUR/USD falling) and yields climb is
// fighting the tide. Bitcoin: who's hitting the market. Binance candles say how
// much of each candle's volume was aggressive buying (taker buys); a breakout
// with real buyers behind it holds better than one on thin, mixed flow.
//
// A check that agrees adds CHECK_BONUS to the confidence, one against takes
// CHECK_PENALTY off (and can drop a setup under the floor, so it waits). What
// each said is kept with the trade (feeds.checks), so the Boss's report shows
// whether they earn their place. Plain data, browser-safe.
import type { Candle } from "./trade-signal";

export type CheckVerdict = "with" | "against" | "flat";
export const CHECK_BONUS = 4;
export const CHECK_PENALTY = 8;

/** EUR/USD moving this much (%) over the last 4 hours is the dollar on the move. */
const EURUSD_MOVE_PCT = 0.15;
/** The US 10-year yield moving this much (% of itself) over 4 hours is a real move. */
const YIELD_MOVE_PCT = 1;
/** Taker buys at or above this share of volume is buyers in control (at or below 1 − it, sellers). */
const FLOW_SHARE = 0.55;

const pctMove = (cs: Candle[], bars: number) => {
  if (cs.length < bars + 1) return NaN;
  const now = cs[cs.length - 1].c;
  const then = cs[cs.length - 1 - bars].c;
  return then > 0 ? ((now - then) / then) * 100 : NaN;
};

/**
 * Which way the US dollar is pushing, from closed hourly EUR/USD candles (the
 * dollar's up when EUR/USD falls) and the US 10-year yield (up with the
 * dollar, as a rule). Null without EUR/USD.
 */
export function dollarRead(
  eurusd: Candle[],
  yields: Candle[],
): { dollar: "up" | "down" | "flat"; note: string } | null {
  const eur = pctMove(eurusd, 4);
  if (!Number.isFinite(eur)) return null;
  const y = pctMove(yields, 4);
  const eurScore = eur <= -EURUSD_MOVE_PCT ? 1 : eur >= EURUSD_MOVE_PCT ? -1 : 0;
  const yScore = !Number.isFinite(y) ? 0 : y >= YIELD_MOVE_PCT ? 1 : y <= -YIELD_MOVE_PCT ? -1 : 0;
  const score = eurScore + yScore;
  const dollar = score >= 1 ? "up" : score <= -1 ? "down" : "flat";
  const parts = [
    `EUR/USD ${eur >= 0 ? "+" : ""}${eur.toFixed(2)}% over 4 hours`,
    ...(Number.isFinite(y) ? [`US 10-year yield ${y >= 0 ? "+" : ""}${y.toFixed(1)}%`] : []),
  ];
  const what =
    dollar === "up"
      ? "the dollar's strengthening"
      : dollar === "down"
        ? "the dollar's weakening"
        : "the dollar's steady";
  return { dollar, note: `${parts.join(", ")}: ${what}` };
}

/** Gold against the dollar: a buy wants it weakening, a sell wants it strengthening. */
export function goldVerdict(
  direction: "BUY" | "SELL",
  dollar: "up" | "down" | "flat",
): CheckVerdict {
  if (dollar === "flat") return "flat";
  return (dollar === "down") === (direction === "BUY") ? "with" : "against";
}

/**
 * Who's been hitting the market over the last few closed candles: the share
 * of volume that was aggressive buying. Null when the feed doesn't say.
 */
export function flowRead(closed: Candle[], bars = 3): { buyShare: number; note: string } | null {
  const last = closed.slice(-bars);
  if (last.length < bars || last.some((c) => !(Number(c.v) > 0) || c.tb == null)) return null;
  const vol = last.reduce((n, c) => n + Number(c.v), 0);
  const buys = last.reduce((n, c) => n + Number(c.tb), 0);
  const buyShare = buys / vol;
  const who =
    buyShare >= FLOW_SHARE
      ? "buyers in control"
      : buyShare <= 1 - FLOW_SHARE
        ? "sellers in control"
        : "evenly split";
  return {
    buyShare,
    note: `Last ${bars} candles: ${Math.round(buyShare * 100)}% of volume was aggressive buying (${who})`,
  };
}

export function flowVerdict(direction: "BUY" | "SELL", buyShare: number): CheckVerdict {
  if (buyShare >= FLOW_SHARE) return direction === "BUY" ? "with" : "against";
  if (buyShare <= 1 - FLOW_SHARE) return direction === "SELL" ? "with" : "against";
  return "flat";
}

/** The confidence after the checks, kept inside the engine's 0–90 range. */
export function adjustConfidence(pct: number, verdicts: CheckVerdict[]): number {
  const delta = verdicts.reduce(
    (n, v) => n + (v === "with" ? CHECK_BONUS : v === "against" ? -CHECK_PENALTY : 0),
    0,
  );
  return Math.max(0, Math.min(90, Math.round(pct + delta)));
}
