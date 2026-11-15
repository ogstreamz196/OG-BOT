import { describe, expect, it } from "vitest";
import type { LearnSample } from "./trade-signal-backtest";
import { DEFAULT_TUNING, type Candle } from "./trade-signal";
import { evaluate } from "./signal-learning.server";
import { compareTargets, TP_RATIOS } from "./signal-tp-compare.server";
import { tallyStrategies, type StrategyRow } from "./signal-random.server";

const MIN = 60_000;

/** A Bitcoin BUY at 100 risking 10 (stop 88 at the default 1.2× room) that runs up to `high`. */
function sample(i: number, high: number): LearnSample {
  const t = i * 3600_000;
  const path: Candle[] = [
    { t, o: 100, h: 101, l: 99, c: 100 },
    { t: t + 5 * MIN, o: 100, h: high, l: 100, c: high - 1 },
    { t: t + 10 * MIN, o: high - 1, h: high - 1, l: high - 2, c: high - 2 },
  ];
  return {
    t,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 70,
    verdict: "trade",
    raw: { risk: 10, targets: [110, 120, 130], atr: 10 },
    path,
    expiresAt: t + 3600_000,
  } as LearnSample;
}

describe("take profit what-if", () => {
  it("leaves learning untouched without a ratio, and puts the target at the stop's distance at 1:1", () => {
    const s = [sample(0, 115)];
    // Today's target: 0.8 of one risk × 0.935 = 107.48, a win of 0.748R.
    expect(evaluate(s, DEFAULT_TUNING).sumR).toBeCloseTo(0.748, 6);
    // 1:1: the stop is 13.2 away (×1.1 SL_WIDEN), so the target is 113.2: a win of 1.32R.
    const one = evaluate(s, DEFAULT_TUNING, 1);
    expect(one).toMatchObject({ n: 1, wins: 1 });
    expect(one.sumR).toBeCloseTo(1.32, 6);
    // 2:1 (124) is never reached: not a win.
    expect(evaluate(s, DEFAULT_TUNING, 2).wins).toBe(0);
  });

  it("compares today's target with every ratio on the same setups, in dollars", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i, 115));
    const c = compareTargets(samples, DEFAULT_TUNING, "BTCUSD", 0.1, 1);
    expect(c.rows.map((r) => r.ratio)).toEqual([null, ...TP_RATIOS]);
    // Today's target is 7.48 against a 13.2 stop.
    expect(c.currentRatio).toBeCloseTo(0.57, 2);
    const one = c.rows.find((r) => r.ratio === 1)!;
    // 30 trades × 1.32R × $10 risk × $1 a lot per $1 × 0.1 lot.
    expect(one.cash).toBeCloseTo(39.6, 2);
    expect(c.rows[0].cash).toBeCloseTo(22.44, 2);
    expect(c.best).not.toBeNull();
  });

  it("names no best with too few trades", () => {
    expect(compareTargets([sample(0, 115)], DEFAULT_TUNING, "BTCUSD").best).toBeUndefined();
  });
});

describe("strategy scoreboard", () => {
  const row = (feeds: Record<string, unknown> | null, status: string, best = 0): StrategyRow => ({
    direction: "BUY",
    entry: 100,
    stop: 90,
    tp1: 108,
    status,
    best_target: best,
    feeds,
  });

  it("tallies each strategy with its demo dollars, skipping bias-only rows", () => {
    const out = tallyStrategies(
      [
        row({ strategy: "desk", paper: { pnl: 4.5 } }, "tp1", 1),
        row({ strategy: "desk", paper: { pnl: -6 } }, "stopped"),
        row(null, "stopped"),
        row({ bias: true }, "tp1", 1),
        row({ strategy: "desk" }, "pending"),
      ],
      (r) => (r.best_target >= 1 ? 0.8 : r.status === "stopped" ? -1 : null),
    );
    expect(out.desk).toMatchObject({ n: 2, wins: 1, losses: 1, cash: -1.5 });
    expect(out.desk!.sumR).toBeCloseTo(-0.2, 6);
    expect(out.engine).toMatchObject({ n: 1, losses: 1, cash: 0 });
  });
});
