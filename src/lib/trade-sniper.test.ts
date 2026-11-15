import { describe, expect, it } from "vitest";
import { sniperEntry, type Candle } from "./trade-signal";

// A flat base of candles, then a 3-candle gap near the end, so sniperEntry has
// a clear fair value gap to read. Times are arbitrary (the maths ignores them).
function withBullishGap(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 84; i++) cs.push({ t: i, o: 100, h: 100.4, l: 99.6, c: 100, v: 1 });
  // c1: high 100 (the gap's bottom), low 98.8 (the gap's origin for the stop).
  cs.push({ t: 84, o: 99, h: 100, l: 98.8, c: 100, v: 1 });
  // c2: the impulse that leaves the gap.
  cs.push({ t: 85, o: 100, h: 103.2, l: 100, c: 103, v: 1 });
  // c3: low 103 (the gap's top). Gap = 103 − 100 = 3.
  cs.push({ t: 86, o: 103, h: 103.6, l: 103, c: 103.5, v: 1 });
  // After the gap, price stays above it (unfilled) and overlaps the impulse's
  // high, so no newer gap forms. Last close is the price now.
  cs.push({ t: 87, o: 103.5, h: 104.2, l: 103.0, c: 104, v: 1 });
  cs.push({ t: 88, o: 104, h: 105.2, l: 103.1, c: 105, v: 1 });
  return cs;
}

describe("sniperEntry", () => {
  it("places a buy limit at the 50% of the last bullish FVG, stop behind its origin", () => {
    const cs = withBullishGap();
    const r = sniperEntry(cs, 1, 1, 0.25, 105);
    expect(r).not.toBeNull();
    expect(r!.basis).toBe("fvg");
    // 50% of the gap [100, 103].
    expect(r!.entry).toBeCloseTo(101.5, 6);
    // Stop just behind the gap origin (98.8) by a spread pad of 0.25 ATR.
    expect(r!.stop).toBeCloseTo(98.8 - 0.25, 6);
    // A limit rests below the price, the stop below the entry.
    expect(r!.entry).toBeLessThan(105);
    expect(r!.stop).toBeLessThan(r!.entry);
  });

  it("mirrors for a sell: limit at the 50% of a bearish FVG, stop above its origin", () => {
    // Mirror the bullish fixture around 100.
    const cs = withBullishGap().map((c) => ({
      ...c,
      o: 200 - c.o,
      h: 200 - c.l,
      l: 200 - c.h,
      c: 200 - c.c,
    }));
    const r = sniperEntry(cs, -1, 1, 0.25, 95);
    expect(r).not.toBeNull();
    expect(r!.basis).toBe("fvg");
    expect(r!.entry).toBeCloseTo(98.5, 6); // 200 − 101.5
    expect(r!.stop).toBeCloseTo(200 - (98.8 - 0.25), 6);
    expect(r!.entry).toBeGreaterThan(95);
    expect(r!.stop).toBeGreaterThan(r!.entry);
  });

  it("is null with no gap or retest to rest a limit on", () => {
    const flat: Candle[] = [];
    for (let i = 0; i < 90; i++) flat.push({ t: i, o: 100, h: 100.4, l: 99.6, c: 100, v: 1 });
    expect(sniperEntry(flat, 1, 1, 0.25, 100)).toBeNull();
  });

  it("is null when the limit would sit on the wrong side of the price", () => {
    const cs = withBullishGap();
    // Price already below the gap's 50%: a buy limit at 101.5 can't rest above it.
    expect(sniperEntry(cs, 1, 1, 0.25, 101)).toBeNull();
  });

  it("needs enough candles", () => {
    const few: Candle[] = [];
    for (let i = 0; i < 40; i++) few.push({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1 });
    expect(sniperEntry(few, 1, 1, 0.25, 100)).toBeNull();
  });
});
