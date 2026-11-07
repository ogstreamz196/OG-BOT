import { describe, expect, it } from "vitest";
import {
  cleanStrategy,
  cleanStrategyName,
  newStrategy,
  parseStrategies,
  strategyBrief,
  MAX_STRATEGIES,
} from "./signal-strategies";
import { DEFAULT_TUNING } from "./trade-signal";

describe("signal strategies", () => {
  it("names are tidied and never empty", () => {
    expect(cleanStrategyName("  big   scalp ")).toBe("big scalp");
    expect(cleanStrategyName("")).toBe("Untitled strategy");
    expect(cleanStrategyName("x".repeat(80))).toHaveLength(48);
  });

  it("a new strategy is a full, default preset", () => {
    const s = newStrategy();
    expect(s.market).toBe("BTCUSD");
    expect(s.tuning).toEqual(DEFAULT_TUNING);
    expect(s.id).toBeTruthy();
  });

  it("cleans a loose/partial strategy into a full one, keeping known knobs", () => {
    const s = cleanStrategy({
      name: "My edge",
      market: "XAUUSD",
      frame: "5M",
      tuning: { minConfidence: 66, bogus: 1 },
    })!;
    expect(s.market).toBe("XAUUSD");
    expect(s.frame).toBe("5M");
    expect(s.tuning.minConfidence).toBe(66);
    expect(s.tuning.runner).toBe(DEFAULT_TUNING.runner);
    expect("bogus" in s.tuning).toBe(false);
  });

  it("falls back to safe defaults for an unknown market/frame", () => {
    const s = cleanStrategy({ name: "x", market: "DOGE", frame: "4H" })!;
    expect(s.market).toBe("BTCUSD");
    expect(s.frame).toBe("15M");
  });

  it("parses a stored list and caps it; junk becomes an empty list", () => {
    const many = JSON.stringify(Array.from({ length: 50 }, () => newStrategy()));
    expect(parseStrategies(many)).toHaveLength(MAX_STRATEGIES);
    expect(parseStrategies("not json")).toEqual([]);
    expect(parseStrategies("{}")).toEqual([]);
  });

  it("brief gives a few short card facts", () => {
    const brief = strategyBrief(newStrategy());
    expect(brief[0]).toMatch(/Bitcoin/);
    expect(brief).toContain(`conf ≥ ${DEFAULT_TUNING.minConfidence}%`);
  });
});
