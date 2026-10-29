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
