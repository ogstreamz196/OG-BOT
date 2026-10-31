import { describe, expect, it } from "vitest";
import { advanceSignal, brokerLevels } from "./trade-signal-outcome";
import { DEFAULT_TUNING } from "./trade-signal";
import { evaluate, exitTargets, safeTuning } from "./signal-learning.server";
import type { LearnSample } from "./trade-signal-backtest";

// Learned exits: a breakeven (stop to entry once far enough in profit) and a
// runner (a third banked at the take profit, the rest run further).

const MIN = 60_000;
const bar = (i: number, l: number, h: number) => ({
  t: i * MIN,
  o: (l + h) / 2,
  h,
  l,
  c: (l + h) / 2,
});
const buy = {
  direction: "BUY" as const,
  entry: 100,
  stop: 95,
  targets: [104, 104, 104] as [number, number, number],
  status: "open" as const,
  expiresAt: 60 * MIN,
};

describe("breakeven", () => {
  it("once the trigger trades, the stop sits at the entry: a pullback there is breakeven, not a loss", () => {
    // Up to 102.5 (the trigger), then all the way down through the old stop.
    const path = [bar(0, 99.5, 102.6), bar(1, 94, 101)];
    expect(advanceSignal(buy, path, 2 * MIN).status).toBe("stopped");
    const r = advanceSignal({ ...buy, beTrigger: 102.5 }, path, 2 * MIN);
    expect(r.events.map((e) => e.kind)).toEqual(["protected", "breakeven"]);
    expect(r.status).toBe("breakeven");
    // Already protected (from an earlier pass): straight to breakeven.
    expect(
      advanceSignal({ ...buy, beTrigger: 102.5, isProtected: true }, [bar(0, 94, 101)], MIN).status,
    ).toBe("breakeven");
  });

  it("at the broker, the stop at entry is hit on the bid like any stop", () => {
    const at = brokerLevels({ ...buy, beTrigger: 102.5 }, 0.25);
    expect(at).toMatchObject({ beStop: 100.25, beTrigger: 102.75, entry: 99.75 });
  });
});

describe("runner", () => {
  it("a third at the take profit, the rest further on", () => {
    expect(exitTargets(100, 104, 0)).toEqual([104, 104, 104]);
    expect(exitTargets(100, 104, 2)).toEqual([104, 108, 108]);
    expect(exitTargets(100, 96, 2)).toEqual([96, 92, 92]);
  });
});

describe("learning exits", () => {
  const sample = (path: ReturnType<typeof bar>[]): LearnSample => ({
    t: 0,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 70,
    verdict: "trade",
    raw: { risk: 5 / 1.2, targets: [105, 110, 115], atr: 4 },
    path,
    expiresAt: 60 * MIN,
  });
  it("breakeven saves the trades that go most of the way then turn", () => {
    const turns = sample([bar(0, 99.8, 103.6), bar(1, 94, 101)]);
    const plain = evaluate([turns], DEFAULT_TUNING);
    const be = evaluate([turns], { ...DEFAULT_TUNING, beAt: 0.5 });
    expect(plain.losses).toBe(1);
    expect(be.losses).toBe(0);
    expect(be.sumR).toBeGreaterThan(plain.sumR);
  });
  it("a runner pays more when the move keeps going", () => {
    const runs = sample([bar(0, 99.8, 101), bar(1, 101, 112), bar(2, 111, 113)]);
    const one = evaluate([runs], DEFAULT_TUNING);
    const runner = evaluate([runs], { ...DEFAULT_TUNING, runner: 2 });
    expect(runner.wins).toBe(1);
    expect(runner.sumR).toBeGreaterThan(one.sumR);
  });
  it("switched on only inside their ranges, off otherwise", () => {
    expect(safeTuning({ ...DEFAULT_TUNING, beAt: 0.2, runner: 1 })).toMatchObject({
      beAt: 0,
      runner: 0,
    });
    expect(safeTuning({ ...DEFAULT_TUNING, beAt: 0.45, runner: 1.3 })).toMatchObject({
      beAt: 0.5,
      runner: 1.5,
    });
    expect(safeTuning({ ...DEFAULT_TUNING, beAt: 9, runner: 9 })).toMatchObject({
      beAt: 1.5,
      runner: 3,
    });
  });
});

describe("learned entry style", () => {
  // A buy found at 100 with the 20 EMA at 98 and the break level at 101: the
  // engine went in at the price now.
  const s: LearnSample = {
    t: 0,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 70,
    verdict: "trade",
    raw: {
      risk: 4,
      targets: [104, 108, 112],
      atr: 4,
      alt: { price: 100, mean: 98, breakAt: 101 },
    },
    path: [],
    expiresAt: 60 * MIN,
  };
  it("tries the same setup on a pullback, on a break, or now; the stop and targets move with it", async () => {
    const { applyTuning } = await import("./signal-learning.server");
    const at = (entryStyle: number) => applyTuning(s, { ...DEFAULT_TUNING, entryStyle });
    expect(at(0)).toMatchObject({ entry: 100, type: "market" });
    expect(at(1)).toMatchObject({ entry: 99, type: "limit" });
    expect(at(2)).toMatchObject({ entry: 101, type: "stop" });
    expect(at(3)).toMatchObject({ entry: 100, type: "market" });
    expect(at(2).stop - at(0).stop).toBeCloseTo(1, 6);
    // A setup saved before entry styles existed only ever uses the engine's.
    expect(
      applyTuning(
        { ...s, raw: { ...s.raw, alt: undefined } },
        { ...DEFAULT_TUNING, entryStyle: 2 },
      ),
    ).toMatchObject({ entry: 100, type: "market" });
  });
});

describe("take profit and stop around real levels", () => {
  // A buy at 100 whose stop hid behind a swing (risk 4 with the 0.25 ATR pad,
  // ATR 4), with a level in the way at 103.
  const s: LearnSample = {
    t: 0,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 70,
    verdict: "trade",
    raw: { risk: 4, targets: [104, 108, 112], atr: 4, ahead: 103, padded: true },
    path: [],
    expiresAt: 60 * MIN,
  };
  it("the stop pad moves the stop (and the first target with the risk)", async () => {
    const { applyTuning } = await import("./signal-learning.server");
    const base = applyTuning(s, DEFAULT_TUNING);
    const wider = applyTuning(s, { ...DEFAULT_TUNING, stopPad: 0.5 });
    // One more ATR of pad: risk 4 → 5, so the stop is 1.2 further down.
    expect(base.stop - wider.stop).toBeCloseTo(1.2, 6);
    expect(wider.targets[0]).toBeGreaterThan(base.targets[0]);
  });
  it("with a take-profit pad, the target sits just short of the level in the way", async () => {
    const { applyTuning } = await import("./signal-learning.server");
    // Pulled-in TP1 is about 103.2: past the level at 103.
    expect(applyTuning(s, DEFAULT_TUNING).targets[0]).toBeGreaterThan(103);
    expect(applyTuning(s, { ...DEFAULT_TUNING, tpPad: 0.1 }).targets[0]).toBeCloseTo(102.6, 6);
    // Too close to bother (under 0.3 of the risk): left alone.
    const near = { ...s, raw: { ...s.raw, ahead: 100.5 } };
    expect(applyTuning(near, { ...DEFAULT_TUNING, tpPad: 0.1 }).targets[0]).toBeGreaterThan(103);
  });
  it("round numbers: gold every $10, bitcoin every $500", async () => {
    const { roundStepFor } = await import("./trade-signal");
    expect(roundStepFor("XAUUSD")).toBe(10);
    expect(roundStepFor("BTCUSD")).toBe(500);
    expect(roundStepFor("EURUSD")).toBeUndefined();
  });
});
