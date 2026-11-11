import { describe, expect, it } from "vitest";
import type { Candle } from "./trade-signal";
import {
  chartTrend,
  frameSamples,
  frameSetupStats,
  STUDY_FRAMES,
} from "./signal-frame-setups.server";
import { DEFAULT_TUNING } from "./trade-signal";

// Patterns are proven per chart: each chart's own history, its own trend.
const bar = (i: number, o: number, h: number, l: number, c: number, ms = 60_000): Candle => ({
  t: i * ms,
  o,
  h,
  l,
  c,
});

describe("per-chart proof", () => {
  it("reads the trend from the chart's own moving averages", () => {
    const up = Array.from({ length: 80 }, (_, i) =>
      bar(i, 100 + i * 0.1, 100.6 + i * 0.1, 99.9 + i * 0.1, 100.5 + i * 0.1),
    );
    const down = up.map((c, i) => bar(i, 200 - c.o, 200 - c.l, 200 - c.h, 200 - c.c));
    const flat = Array.from({ length: 80 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
    expect(chartTrend(up)).toBe("bullish");
    expect(chartTrend(down)).toBe("bearish");
    expect(chartTrend(flat)).toBeUndefined();
    expect(chartTrend(up.slice(0, 30))).toBeUndefined();
  });

  it("finds each setup on the chart's history, with the candles after it as the path", () => {
    // Flat history with a wick rejection at candle 200, then a rally.
    const cs = Array.from({ length: 260 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
    cs[200] = bar(200, 100, 100.2, 98.6, 100.1);
    for (let k = 201; k < 260; k++) cs[k] = bar(k, 100.2, 102.5, 100.1, 102);
    const found = frameSamples(cs, "1m", () => 0.1);
    const wick = found.wick_rejection?.find((s) => s.t === cs[200].t);
    expect(wick).toMatchObject({ direction: "BUY", entry: 100.1, entryType: "market", cost: 0.1 });
    expect(wick!.path).toHaveLength(STUDY_FRAMES["1m"].horizon);
    expect(wick!.path[0].t).toBe(cs[201].t);
  });

  it("a setup is only live on a chart after enough winning trades there", async () => {
    // A winning wick rejection in 14 of 18 stretches, 40 candles apart.
    const cs: Candle[] = [];
    for (let r = 0; r < 18; r++) {
      const base = r * 40;
      for (let k = 0; k < 40; k++) cs.push(bar(base + k, 100, 100.5, 99.5, 100));
      if (r < 4) continue;
      cs[base + 20] = bar(base + 20, 100, 100.2, 98.6, 100.1);
      for (let k = 21; k < 30; k++) cs[base + k] = bar(base + k, 100.2, 103, 100.1, 102.8);
    }
    const stats = await frameSetupStats(cs, "1m", DEFAULT_TUNING, () => 0.05);
    expect(stats.wick_rejection).toMatchObject({ n: 14, live: true });
    expect(stats.wick_rejection!.winRate).toBeGreaterThanOrEqual(0.5);
    // The same with only a few of them: not live.
    const few = await frameSetupStats(cs.slice(0, 9 * 40), "1m", DEFAULT_TUNING, () => 0.05);
    expect(few.wick_rejection?.live).toBe(false);
  });
});
