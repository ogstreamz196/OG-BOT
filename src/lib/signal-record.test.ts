import { describe, expect, it } from "vitest";
import { recordText, tallyRecord } from "./signal-record.server";
import { setupKey } from "./signal-results.server";

const sig = (over: Record<string, unknown> = {}) => ({
  market: "XAUUSD",
  label: "XAU/USD",
  direction: "BUY" as const,
  entry: 2400,
  stop: 2395,
  tp1: 2403,
  tp2: 2406,
  tp3: 2410,
  pip: 0.1,
  decimals: 2,
  feeds: null as { bias?: boolean } | null,
  ...over,
});
const result = (s: ReturnType<typeof sig>, outcome: "win" | "loss", pips: number) => ({
  setup_key: setupKey({ ...s, id: "" }),
  market: s.market,
  label: s.label,
  direction: s.direction,
  outcome,
  best_target: outcome === "win" ? 1 : 0,
  pips,
  unit: "pips" as const,
  decided_at: "2026-10-28T10:00:00Z",
});

describe("70%+ record", () => {
  it("counts each 70%+ setup once, with its wins, losses and pips", () => {
    const a = sig();
    const b = sig({ entry: 2410, stop: 2405 });
    const biasCall = sig({ entry: 2420, stop: 2415, feeds: { bias: true } });
    const other = sig({ entry: 2430, stop: 2425 });
    const r = tallyRecord(
      [a, { ...a }, b, biasCall],
      [
        result(a, "win", 30),
        result(b, "loss", -60),
        result(biasCall, "win", 30),
        result(other, "win", 99),
      ],
      "2026-10-01T00:00:00Z",
    );
    expect(r).toMatchObject({ signals: 2, wins: 1, losses: 1 });
    expect(r.markets).toEqual([{ label: "XAU/USD", unit: "pips", pips: -30 }]);
    expect(recordText(r)).toBe(
      "🏆 70%+ RECORD since 1 Oct 2026 · 2 signals · ✅ 1 won · 🛑 1 lost\n🔴 XAU/USD −30.0 pips",
    );
  });
  it("reads cleanly before anything has closed", () => {
    expect(recordText(tallyRecord([], [], null))).toBe(
      "🏆 70%+ RECORD · 0 signals · ✅ 0 won · 🛑 0 lost",
    );
  });
});
