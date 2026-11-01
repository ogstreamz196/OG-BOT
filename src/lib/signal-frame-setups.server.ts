// The per-chart proof for the extra setups and chart patterns (the Boss's
// rule: a pattern only posts on the chart it was proven on). The main study
// (signal-learning.server.ts) proves them on the 5-minute chart; this one
// proves them on the 1-minute, 15-minute and hourly charts, each from that
// chart's own history (gold and bitcoin only, no AI).
//
// For each chart: about 4,000 of its own candles, the trend read from the
// same chart (chartTrend: 20 EMA against 50 EMA, price on the right side),
// every setup findSetups sees, each followed exactly like the 5-minute study
// follows them (evaluate: market entry, the market's stop room and target
// pull-in, the profit lock, the spread). A setup is live on a chart with
// SETUP_MIN_TRADES trades, its win rate (setupMinWinRate) and a positive
// average. Live, the same chartTrend is used on that chart, so the proof and
// the live read match.
import { ema, type Candle, type Tuning } from "./trade-signal";
import { findSetups, SETUP_IDS, type SetupId } from "./trade-setups";
import type { LearnSample } from "./trade-signal-backtest";

export type StudyFrame = "1m" | "15m" | "1h";

/** Each studied chart: Binance history key, days of history, and how long a trade may run (candles). */
export const STUDY_FRAMES: Record<
  StudyFrame,
  { key: "minute" | "fifteen" | "hourly"; days: number; horizon: number; ms: number }
> = {
  "1m": { key: "minute", days: 3, horizon: 30, ms: 60_000 },
  "15m": { key: "fifteen", days: 45, horizon: 16, ms: 900_000 },
  "1h": { key: "hourly", days: 180, horizon: 24, ms: 3_600_000 },
};

/** Candles findSetups reads at each point. */
const WINDOW = 150;
/** The same setup isn't counted again within this many candles. */
const COOLDOWN = 5;

/**
 * The trend on a chart, from its own closed candles: the 20 EMA over the 50
 * EMA with the close above both is bullish, the other way round bearish,
 * anything else none. Pure.
 */
export function chartTrend(cs: Candle[]): "bullish" | "bearish" | undefined {
  if (cs.length < 60) return undefined;
  const closes = cs.map((c) => c.c);
  const fast = ema(closes, 20).at(-1)!;
  const slow = ema(closes, 50).at(-1)!;
  const last = closes[closes.length - 1];
  if (fast > slow && last > fast) return "bullish";
  if (fast < slow && last < fast) return "bearish";
  return undefined;
}

/**
 * Every setup on a chart's history, as samples the 5-minute study's evaluate
 * can follow (market entry at the setup's close, the candles after it as the
 * path, `cost` the spread at that time). Pure.
 */
export function frameSamples(
  cs: Candle[],
  frame: StudyFrame,
  cost: (t: number) => number,
): Partial<Record<SetupId, LearnSample[]>> {
  const { horizon, ms } = STUDY_FRAMES[frame];
  const out: Partial<Record<SetupId, LearnSample[]>> = {};
  const lastAt: Partial<Record<SetupId, number>> = {};
  for (let i = WINDOW - 1; i < cs.length - 1; i++) {
    const window = cs.slice(i - WINDOW + 1, i + 1);
    for (const h of findSetups(window, chartTrend(window))) {
      if (i - (lastAt[h.id] ?? -Infinity) < COOLDOWN) continue;
      lastAt[h.id] = i;
      const t = cs[i].t;
      (out[h.id] ??= []).push({
        t,
        direction: h.direction,
        entry: h.entry,
        entryType: "market",
        confidencePct: h.confidencePct,
        verdict: "trade",
        raw: { risk: h.risk, targets: h.targets, atr: h.atr },
        path: cs.slice(i + 1, i + 1 + horizon),
        expiresAt: t + (horizon + 1) * ms,
        cost: cost(t),
      });
    }
  }
  return out;
}

/** Stats like the 5-minute study's SetupStats. */
export type FrameSetupStats = {
  n: number;
  wins: number;
  losses: number;
  sumR: number;
  winRate: number;
  avgR: number;
  live: boolean;
};

/**
 * Each setup's record on a chart, followed under the market's setting with
 * no time limits of the 5-minute kind (each chart's trades run `horizon`
 * candles), and whether it has earned live use there.
 */
export async function frameSetupStats(
  cs: Candle[],
  frame: StudyFrame,
  tune: Tuning,
  cost: (t: number) => number,
): Promise<Partial<Record<SetupId, FrameSetupStats>>> {
  const { evaluate, setupMinWinRate, SETUP_MIN_TRADES } = await import("./signal-learning.server");
  const { NO_TIME_LIMIT } = await import("./trade-signal");
  const samples = frameSamples(cs, frame, cost);
  const rules = { ...tune, minConfidence: 0, holdFor: NO_TIME_LIMIT, fillWithin: NO_TIME_LIMIT };
  const out: Partial<Record<SetupId, FrameSetupStats>> = {};
  for (const id of SETUP_IDS) {
    const list = samples[id];
    if (!list?.length) continue;
    const e = evaluate(list, rules);
    out[id] = {
      ...e,
      live: e.n >= SETUP_MIN_TRADES && e.winRate >= setupMinWinRate(id) && e.avgR > 0,
    };
  }
  return out;
}

/**
 * Studies every chart for one market: fetches its history (the perpetual
 * first for gold, then the spot token) and works out each setup's record.
 * A chart whose history can't be read is left out. Never throws.
 */
export async function studyFrames(
  market: { code: string; symbol: string; futures?: string },
  tune: Tuning,
  cost: (t: number) => number,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
  frames: StudyFrame[] = Object.keys(STUDY_FRAMES) as StudyFrame[],
): Promise<Partial<Record<StudyFrame, Partial<Record<SetupId, FrameSetupStats>>>>> {
  const { fetchBinanceHistory } = await import("./trade-signal-backtest");
  const out: Partial<Record<StudyFrame, Partial<Record<SetupId, FrameSetupStats>>>> = {};
  for (const frame of frames) {
    const { key, days, ms } = STUDY_FRAMES[frame];
    const start = now - days * 86_400_000;
    let cs: Candle[] = [];
    for (const futures of market.futures ? [true, false] : [false]) {
      try {
        cs = await fetchBinanceHistory(
          futures ? market.futures! : market.symbol,
          key,
          start,
          now,
          fetcher,
          { futures },
        );
        if (cs.length) break;
      } catch {
        /* try the next feed */
      }
    }
    // Only finished candles.
    cs = cs.filter((c) => c.t + ms <= now);
    if (cs.length < WINDOW + 10) continue;
    out[frame] = await frameSetupStats(cs, frame, tune, cost);
  }
  return out;
}
