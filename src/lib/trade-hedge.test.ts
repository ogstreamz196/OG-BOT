import { describe, expect, it } from "vitest";
import { hedgePlan } from "./trade-setups";
import type { SetupHit } from "./trade-setups";
import { lockOf } from "./trade-signal-tracker.server";
import type { TradePlan } from "./trade-signal";

// A minimal engine plan to spread onto (the hedge overrides what matters).
const base = {
  direction: "SELL",
  entry: 100,
  entryType: "market",
  entryNote: "",
  stop: 110,
  targets: [90, 80, 70],
  rr: "1:1",
  confidence: "Medium",
  confidencePct: 65,
  quality: "Clean",
  cautions: [],
  verdict: "trade",
  score: 0,
  maxScore: 1,
  reasons: [],
  invalidation: "",
  resistance: [],
  support: [],
  raw: { risk: 10, targets: [90, 80, 70], atr: 10 },
} as unknown as TradePlan;

const hit = (over: Partial<SetupHit> = {}): SetupHit => ({
  id: "sweep_reclaim",
  direction: "BUY",
  entry: 100,
  risk: 10,
  targets: [110, 120, 130],
  atr: 10,
  confidencePct: 66,
  ...over,
});

describe("hedgePlan", () => {
  it("is a market entry with a single 1R target, tagged as a hedge", () => {
    const p = hedgePlan(base, hit(), 100)!;
    expect(p).not.toBeNull();
    expect(p.hedge).toBe(true);
    expect(p.direction).toBe("BUY");
    expect(p.entryType).toBe("market");
    expect(p.stop).toBe(90); // entry − 1R
    expect(p.targets).toEqual([110, 110, 110]); // one 1R target
    expect(p.rr).toBe("1:1");
    expect(p.verdict).toBe("trade");
  });

  it("mirrors for a sell hedge", () => {
    const p = hedgePlan(base, hit({ direction: "SELL", targets: [90, 80, 70] }), 100)!;
    expect(p.direction).toBe("SELL");
    expect(p.stop).toBe(110);
    expect(p.targets).toEqual([90, 90, 90]);
  });

  it("only reversal setups can hedge", () => {
    expect(hedgePlan(base, hit({ id: "breakout_retest" }), 100)).toBeNull();
    expect(hedgePlan(base, hit({ id: "fvg_retest" }), 100)).toBeNull();
    expect(hedgePlan(base, hit({ id: "wick_rejection" }), 100)).not.toBeNull();
    expect(hedgePlan(base, hit({ id: "exhaustion_reversal" }), 100)).not.toBeNull();
  });

  it("is null once price has run more than half the risk from the setup", () => {
    expect(hedgePlan(base, hit(), 106)).toBeNull();
  });
});

describe("lockOf for a hedge: break-even at 0.5R", () => {
  it("triggers halfway to the 1R target and moves the stop to entry (buy)", () => {
    const lock = lockOf({ direction: "BUY", entry: 100, tp1: 110, feeds: { hedge: true } });
    expect(lock).toEqual({ trigger: 105, stop: 100 });
  });
  it("mirrors for a sell hedge", () => {
    const lock = lockOf({ direction: "SELL", entry: 100, tp1: 90, feeds: { hedge: true } });
    expect(lock).toEqual({ trigger: 95, stop: 100 });
  });
  it("a non-hedge with the lock still uses the profit lock, not 0.5R", () => {
    const lock = lockOf({ direction: "BUY", entry: 100, tp1: 110, feeds: { lock: true } });
    // Not the hedge's { trigger: 105, stop: 100 }.
    expect(lock).not.toEqual({ trigger: 105, stop: 100 });
  });
});
