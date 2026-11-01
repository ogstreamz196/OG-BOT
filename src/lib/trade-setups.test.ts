import { describe, expect, it } from "vitest";
import { DEFAULT_TUNING, type Candle, type TradePlan } from "./trade-signal";
import { findSetups, setupPlan } from "./trade-setups";
import { evaluateSetups, SETUP_MIN_TRADES } from "./signal-learning.server";
import type { LearnSample } from "./trade-signal-backtest";

const M5 = 300_000;
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  t: i * M5,
  o,
  h,
  l,
  c,
});
/** Flat candles around 100, a 1-point range each. */
const flat = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 100, 100.5, 99.5, 100));

describe("findSetups", () => {
  it("spots a breakout and retest", () => {
    const cs = flat(72);
    const at = (k: number) => 72 + k;
    cs.push(bar(at(0), 100, 101.2, 100.4, 101)); // closes through 100.5
    for (let k = 1; k < 7; k++) cs.push(bar(at(k), 100.9, 101, 100.6, 100.8)); // back to the level
    cs.push(bar(at(7), 100.7, 101.3, 100.65, 101.2)); // and away again
    const hit = findSetups(cs).find((h) => h.id === "breakout_retest");
    expect(hit).toMatchObject({ direction: "BUY", entry: 101.2 });
    expect(hit!.targets[0]).toBeGreaterThan(101.2);
    expect(hit!.targets[2]).toBeGreaterThan(hit!.targets[1]);
  });

  it("spots a sweep of the lows that closes back inside", () => {
    const cs = flat(78);
    cs.push(bar(78, 99.9, 100, 99.2, 99.8)); // pokes under 99.5, closes back above
    cs.push(bar(79, 99.8, 100.2, 99.7, 100));
    const hit = findSetups(cs).find((h) => h.id === "sweep_reclaim");
    expect(hit).toMatchObject({ direction: "BUY", entry: 100 });
    expect(hit!.risk).toBeGreaterThan(0);
  });

  it("fades the bottom of a clear sideways range", () => {
    // Random sideways prices (no trend), then a bounce off the range's bottom.
    let seed = 9301 + 49297;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    let x = 0;
    const cs: Candle[] = [];
    for (let i = 0; i < 139; i++) {
      const o = 100 + x;
      x = 0.6 * x + (rnd() - 0.5) * 2.4;
      const c = 100 + x;
      cs.push(bar(i, o, Math.max(o, c) + rnd() * 0.3, Math.min(o, c) - rnd() * 0.3, c));
    }
    const box = cs.slice(-47);
    const bottom = Math.min(...box.map((k) => k.l));
    const top = Math.max(...box.map((k) => k.h));
    cs.push(bar(139, bottom + 0.1, bottom + 0.5, bottom + 0.05, bottom + 0.4));
    const hit = findSetups(cs).find((h) => h.id === "range_fade");
    expect(hit?.direction).toBe("BUY");
    // Aiming at the middle of the range first, then the top.
    expect(hit!.targets[0]).toBeCloseTo((top + bottom) / 2, 6);
    expect(hit!.targets[2]).toBeCloseTo(top, 6);
  });

  it("siding with the bigger timeframe adds confidence, fighting it takes some off", () => {
    const cs = flat(78);
    cs.push(bar(78, 99.9, 100, 99.2, 99.8), bar(79, 99.8, 100.2, 99.7, 100));
    const pct = (b?: "bullish" | "bearish") =>
      findSetups(cs, b).find((h) => h.id === "sweep_reclaim")!.confidencePct;
    expect(pct("bullish")).toBeGreaterThan(pct());
    expect(pct("bearish")).toBeLessThan(pct());
  });
});

describe("setupPlan", () => {
  const base = {
    cautions: ["No clean setup", "Volume is light"],
    qualityNote: "No clean setup",
  } as TradePlan;
  const hit = {
    id: "sweep_reclaim" as const,
    direction: "BUY" as const,
    entry: 100,
    risk: 2,
    targets: [102, 104, 106] as [number, number, number],
    atr: 1,
    confidencePct: 72,
  };
  it("becomes a market trade at the price now, with the members' stop room", () => {
    const p = setupPlan(base, hit, 100.4, DEFAULT_TUNING)!;
    expect(p).toMatchObject({
      verdict: "trade",
      entryType: "market",
      entry: 100.4,
      setup: "Liquidity sweep & reclaim",
    });
    expect(p.stop).toBeCloseTo(100.4 - 2 * DEFAULT_TUNING.stopRoom, 9);
    expect(p.targets[0]).toBeGreaterThan(100.4);
    expect(p.cautions).toEqual(["Volume is light"]);
  });
  it("is dropped once price has run off", () => {
    expect(setupPlan(base, hit, 101.5, DEFAULT_TUNING)).toBeNull();
  });
});

describe("evaluateSetups", () => {
  const sample = (i: number, win: boolean): LearnSample => ({
    t: i * 3600_000,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 60,
    verdict: "wait",
    raw: { risk: 2, targets: [102, 104, 106], atr: 1 },
    path: [
      { t: i * 3600_000, o: 100, h: win ? 103 : 100.2, l: win ? 99.8 : 97, c: win ? 102.5 : 97.5 },
    ],
    expiresAt: i * 3600_000 + 3600_000,
    setups: [
      {
        id: "breakout_retest",
        direction: "BUY",
        entry: 100,
        risk: 2,
        targets: [102, 104, 106],
        atr: 1,
        confidencePct: 70,
      },
    ],
  });
  it("only earns live use with enough trades, winning at least half and paying", () => {
    const good = Array.from({ length: SETUP_MIN_TRADES }, (_, i) => sample(i, i % 3 !== 0));
    expect(evaluateSetups(good, DEFAULT_TUNING).breakout_retest).toMatchObject({
      n: SETUP_MIN_TRADES,
      live: true,
    });
    const few = good.slice(0, SETUP_MIN_TRADES - 1);
    expect(evaluateSetups(few, DEFAULT_TUNING).breakout_retest?.live).toBe(false);
    const bad = Array.from({ length: 20 }, (_, i) => sample(i, i % 3 === 0));
    expect(evaluateSetups(bad, DEFAULT_TUNING).breakout_retest?.live).toBe(false);
  });
});

describe("fast scalps: wicks and reversals", () => {
  it("spots a long lower wick that tested the lows and got thrown back", () => {
    const cs = flat(79);
    // Opens 100, dips to 98.6 (under every low), closes 100.1 near the top.
    cs.push(bar(79, 100, 100.2, 98.6, 100.1));
    const hit = findSetups(cs).find((h) => h.id === "wick_rejection");
    expect(hit).toMatchObject({ direction: "BUY", entry: 100.1 });
    // Stop just past the wick's tip, quick targets.
    expect(100.1 - hit!.risk).toBeLessThan(98.6);
    expect(hit!.targets[0]).toBeCloseTo(100.1 + hit!.risk);
    expect(hit!.targets[2]).toBeCloseTo(100.1 + hit!.risk * 2);
  });

  it("the same at the highs, as a sell", () => {
    const cs = flat(79);
    cs.push(bar(79, 100, 101.4, 99.8, 99.9));
    expect(findSetups(cs).find((h) => h.id === "wick_rejection")).toMatchObject({
      direction: "SELL",
    });
  });

  it("not a wick that didn't test the recent extreme, or a big body", () => {
    const inside = flat(79);
    inside.push(bar(79, 100, 100.2, 99.6, 100.1)); // dip stays inside the lows
    expect(findSetups(inside).find((h) => h.id === "wick_rejection")).toBeUndefined();
    const body = flat(79);
    body.push(bar(79, 99, 100.2, 98.6, 100.1)); // mostly body, not wick
    expect(findSetups(body).find((h) => h.id === "wick_rejection")).toBeUndefined();
  });

  it("spots an exhaustion reversal: a stretched run down swallowed by a buy candle", () => {
    const cs = flat(74);
    // Five candles running down hard, 2+ ATR under the 20 EMA.
    let p = 100;
    for (let k = 0; k < 5; k++) {
      cs.push(bar(74 + k, p, p + 0.1, p - 1.1, p - 1));
      p -= 1;
    }
    // Then one up candle closing past the last one's open.
    cs.push(bar(79, p, p + 1.4, p - 0.2, p + 1.2));
    const hit = findSetups(cs).find((h) => h.id === "exhaustion_reversal");
    expect(hit).toMatchObject({ direction: "BUY", entry: p + 1.2 });
    expect(hit!.targets[0]).toBeGreaterThan(p + 1.2);
  });

  it("not a reversal without the stretch", () => {
    const cs = flat(74);
    for (let k = 0; k < 5; k++) cs.push(bar(74 + k, 100, 100.1, 99.85, 99.9));
    cs.push(bar(79, 99.9, 100.2, 99.8, 100.15));
    expect(findSetups(cs).find((h) => h.id === "exhaustion_reversal")).toBeUndefined();
  });

  it("a proven setup is as sure as it has been accurate", async () => {
    const { provenConfidence } = await import("./signal-learning.server");
    expect(provenConfidence(62, { winRate: 0.78 })).toBe(78);
    expect(provenConfidence(62, { winRate: 0.52 })).toBe(62);
    expect(provenConfidence(62, { winRate: 0.95 })).toBe(85);
    expect(provenConfidence(62, undefined)).toBe(62);
  });
});

describe("classic chart patterns", () => {
  /** Flat candles, two lows at `a` and `b` (indexes 30 and 50), and a last candle. */
  const doubleBottom = (a: number, b: number, last: Candle) => {
    const cs = flat(79);
    cs[30] = bar(30, 99.3, 99.6, a, 99.2);
    cs[50] = bar(50, 99.3, 99.6, b, 99.2);
    cs.push(last);
    return cs;
  };

  it("double bottom: two lows within 0.2 ATR, 20 candles apart, first close over the neckline", () => {
    const cs = doubleBottom(98.7, 98.8, bar(79, 100, 101, 99.9, 100.8));
    const hit = findSetups(cs).find((h) => h.id === "double_top_bottom");
    expect(hit).toMatchObject({ direction: "BUY", entry: 100.8 });
    // Stop past the second bottom (98.8), targets 1, 1.5, 2 risks.
    expect(100.8 - hit!.risk).toBeLessThan(98.8);
    expect(hit!.targets[0]).toBeCloseTo(100.8 + hit!.risk);
    expect(hit!.targets[1]).toBeCloseTo(100.8 + hit!.risk * 1.5);
    expect(hit!.targets[2]).toBeCloseTo(100.8 + hit!.risk * 2);
  });

  it("double bottom: not with lows too far apart in price, or without the neckline break", () => {
    const uneven = doubleBottom(98.7, 99.1, bar(79, 100, 101, 99.9, 100.8));
    expect(findSetups(uneven).find((h) => h.id === "double_top_bottom")).toBeUndefined();
    const noBreak = doubleBottom(98.7, 98.8, bar(79, 100, 100.4, 99.9, 100.3));
    expect(findSetups(noBreak).find((h) => h.id === "double_top_bottom")).toBeUndefined();
  });

  it("a double bottom whose real stop needs over 2.5 ATR is skipped, never given a tighter stop", () => {
    // Lows at 97 and a close at 101: the stop past the second bottom is ~4 ATR away.
    const wide = doubleBottom(97, 97.1, bar(79, 100, 101.2, 99.9, 101));
    expect(findSetups(wide).find((h) => h.id === "double_top_bottom")).toBeUndefined();
  });

  it("double top: the same upside down, as a sell", () => {
    const cs = flat(79);
    cs[30] = bar(30, 100.7, 101.3, 100.6, 100.8);
    cs[50] = bar(50, 100.7, 101.2, 100.6, 100.8);
    cs.push(bar(79, 100, 100.1, 99, 99.2));
    expect(findSetups(cs).find((h) => h.id === "double_top_bottom")).toMatchObject({
      direction: "SELL",
      entry: 99.2,
    });
  });

  /** A 4-candle pole up from 100, a flag with its low at `low`, and a last candle. */
  const bullFlag = (low: number, last: Candle) => {
    const cs = flat(71);
    cs.push(bar(71, 100, 101, 99.9, 101));
    cs.push(bar(72, 101, 102, 100.9, 102));
    cs.push(bar(73, 102, 103, 101.9, 103));
    cs.push(bar(74, 103, 103.6, 102.9, 103.5));
    for (let k = 75; k < 81; k++) cs.push(bar(k, 103.3, 103.5, low, 103));
    cs.push(last);
    return cs;
  };

  it("bull flag: a 1.5 ATR pole, a tight shallow flag, and a close above it", () => {
    const hit = findSetups(bullFlag(102.6, bar(81, 103, 104, 102.9, 103.9))).find(
      (h) => h.id === "flag_continuation",
    );
    expect(hit).toMatchObject({ direction: "BUY", entry: 103.9 });
    // Stop just under the flag's base (102.6).
    expect(103.9 - hit!.risk).toBeLessThan(102.6);
    expect(103.9 - hit!.risk).toBeGreaterThan(102.3);
    expect(hit!.targets[2]).toBeCloseTo(103.9 + hit!.risk * 2);
  });

  it("bull flag: not when the flag gives back too much, or before the breakout", () => {
    const deep = bullFlag(100.5, bar(81, 103, 104, 102.9, 103.9));
    expect(findSetups(deep).find((h) => h.id === "flag_continuation")).toBeUndefined();
    const inside = bullFlag(102.6, bar(81, 103, 103.4, 102.9, 103.3));
    expect(findSetups(inside).find((h) => h.id === "flag_continuation")).toBeUndefined();
  });

  /** A bullish gap (100.5 to 101.2) at candles 72–74, held, then a last candle. */
  const bullGap = (last: Candle) => {
    const cs = flat(72);
    cs.push(bar(72, 100, 100.5, 99.9, 100.3));
    cs.push(bar(73, 100.4, 102, 100.3, 101.9));
    cs.push(bar(74, 101.9, 102.5, 101.2, 102.3));
    for (let k = 75; k < 80; k++) cs.push(bar(k, 102.3, 102.8, 101.6, 102.4));
    cs.push(last);
    return cs;
  };
  const tap = bar(80, 101.3, 101.6, 101, 101.5);

  it("fair value gap: taps into the gap and closes back out with the bigger trend", () => {
    const hit = findSetups(bullGap(tap), "bullish").find((h) => h.id === "fvg_retest");
    expect(hit).toMatchObject({ direction: "BUY", entry: 101.5 });
    // Stop under the gap's origin (candle 1's low, 99.9), targets 1, 1.5, 2 risks.
    expect(101.5 - hit!.risk).toBeLessThan(99.9);
    expect(hit!.targets[1]).toBeCloseTo(101.5 + hit!.risk * 1.5);
    // Trend alignment puts it in the 70–80% band.
    expect(hit!.confidencePct).toBe(72);
  });

  it("fair value gap: never against or without the bigger trend, nor without a tap", () => {
    expect(findSetups(bullGap(tap)).find((h) => h.id === "fvg_retest")).toBeUndefined();
    expect(findSetups(bullGap(tap), "bearish").find((h) => h.id === "fvg_retest")).toBeUndefined();
    const noTap = bar(80, 102.3, 102.9, 101.7, 102.6);
    expect(
      findSetups(bullGap(noTap), "bullish").find((h) => h.id === "fvg_retest"),
    ).toBeUndefined();
  });

  /** The same chart upside down around 100: every buy fixture becomes its sell. */
  const mirror = (cs: Candle[]) =>
    cs.map((c) => ({ t: c.t, o: 200 - c.o, h: 200 - c.l, l: 200 - c.h, c: 200 - c.c }));
  const find = (cs: Candle[], id: string, b?: "bullish" | "bearish") =>
    findSetups(cs, b).find((h) => h.id === id);

  it("double top: stop past the second top, targets 1, 1.5 and 2 risks below", () => {
    const hit = find(
      mirror(doubleBottom(98.7, 98.8, bar(79, 100, 101, 99.9, 100.8))),
      "double_top_bottom",
    );
    expect(hit).toMatchObject({ direction: "SELL", entry: 99.2 });
    // Second top at 101.2: the stop sits above it.
    expect(99.2 + hit!.risk).toBeGreaterThan(101.2);
    expect(hit!.targets[0]).toBeCloseTo(99.2 - hit!.risk);
    expect(hit!.targets[1]).toBeCloseTo(99.2 - hit!.risk * 1.5);
    expect(hit!.targets[2]).toBeCloseTo(99.2 - hit!.risk * 2);
    // And not without the neckline break, or with tops too far apart.
    const noBreak = mirror(doubleBottom(98.7, 98.8, bar(79, 100, 100.4, 99.9, 100.3)));
    expect(find(noBreak, "double_top_bottom")).toBeUndefined();
    const uneven = mirror(doubleBottom(98.7, 99.1, bar(79, 100, 101, 99.9, 100.8)));
    expect(find(uneven, "double_top_bottom")).toBeUndefined();
  });

  it("bear flag: a pole down, a tight flag, a close under it; stop over the flag's top", () => {
    const hit = find(mirror(bullFlag(102.6, bar(81, 103, 104, 102.9, 103.9))), "flag_continuation");
    expect(hit).toMatchObject({ direction: "SELL", entry: 96.1 });
    // Flag's top is 97.4: the stop just above it.
    expect(96.1 + hit!.risk).toBeGreaterThan(97.4);
    expect(96.1 + hit!.risk).toBeLessThan(97.7);
    expect(hit!.targets[0]).toBeCloseTo(96.1 - hit!.risk);
    expect(hit!.targets[1]).toBeCloseTo(96.1 - hit!.risk * 1.5);
    expect(hit!.targets[2]).toBeCloseTo(96.1 - hit!.risk * 2);
    const deep = mirror(bullFlag(100.5, bar(81, 103, 104, 102.9, 103.9)));
    expect(find(deep, "flag_continuation")).toBeUndefined();
    const inside = mirror(bullFlag(102.6, bar(81, 103, 103.4, 102.9, 103.3)));
    expect(find(inside, "flag_continuation")).toBeUndefined();
  });

  it("bearish fair value gap: only with a bearish bigger trend; stop over the gap's origin", () => {
    const cs = mirror(bullGap(tap));
    const hit = find(cs, "fvg_retest", "bearish");
    expect(hit).toMatchObject({ direction: "SELL", entry: 98.5 });
    // Candle 1's high is 100.1: the stop sits above it.
    expect(98.5 + hit!.risk).toBeGreaterThan(100.1);
    expect(hit!.targets[2]).toBeCloseTo(98.5 - hit!.risk * 2);
    expect(hit!.confidencePct).toBe(72);
    expect(find(cs, "fvg_retest", "bullish")).toBeUndefined();
    expect(find(cs, "fvg_retest")).toBeUndefined();
  });

  it("no chart pattern reaches the 70% posting floor without the bigger trend", async () => {
    const { BROADCAST_MIN_CONFIDENCE } = await import("./signal-broadcast.server");
    expect(BROADCAST_MIN_CONFIDENCE).toBe(70);
    const cases: [Candle[], string][] = [
      [doubleBottom(98.7, 98.8, bar(79, 100, 101, 99.9, 100.8)), "double_top_bottom"],
      [bullFlag(102.6, bar(81, 103, 104, 102.9, 103.9)), "flag_continuation"],
    ];
    for (const [cs, id] of cases) {
      for (const chart of [cs, mirror(cs)]) {
        const up = find(chart, id)!.direction === "BUY";
        expect(find(chart, id)!.confidencePct).toBeLessThan(BROADCAST_MIN_CONFIDENCE);
        const against = find(chart, id, up ? "bearish" : "bullish")!;
        expect(against.confidencePct).toBeLessThan(BROADCAST_MIN_CONFIDENCE);
        const withIt = find(chart, id, up ? "bullish" : "bearish")!;
        expect(withIt.confidencePct).toBeGreaterThanOrEqual(BROADCAST_MIN_CONFIDENCE);
        expect(withIt.confidencePct).toBeLessThanOrEqual(80);
      }
    }
  });

  it("chart patterns need 55% to go live; scanned charts map back to their frame", async () => {
    const { setupMinWinRate } = await import("./signal-learning.server");
    expect(setupMinWinRate("double_top_bottom")).toBe(0.55);
    expect(setupMinWinRate("flag_continuation")).toBe(0.55);
    expect(setupMinWinRate("fvg_retest")).toBe(0.55);
    expect(setupMinWinRate("sweep_reclaim")).toBe(0.5);
    const { frameOf } = await import("./signal-broadcast.server");
    expect(["1M", "5M", "15M", "1H", undefined].map(frameOf)).toEqual([
      "1m",
      "5m",
      "15m",
      "1h",
      "5m",
    ]);
  });
});
