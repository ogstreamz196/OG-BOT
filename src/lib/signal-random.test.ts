import { describe, expect, it, vi } from "vitest";
import {
  pickStrategy,
  RANDOM_MIN_TRADES,
  STRATEGIES,
  strategyAsk,
  strategyLines,
  strategyScore,
  tagStrategy,
} from "./signal-random.server";

vi.mock("./signal-chat.server", async (real) => ({
  ...(await real<object>()),
  chatPurgedAt: async () => null,
}));

// Random signals: a strategy picked at random, leaning towards what wins.
const seeded = (seed: number) => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

describe("random strategy signals", () => {
  it("has the chart engine, the AI desk and every setup and pattern", () => {
    expect(STRATEGIES.slice(0, 2)).toEqual(["engine", "desk"]);
    expect(STRATEGIES).toContain("flag_continuation");
    expect(STRATEGIES).toContain("wick_rejection");
  });

  it("leans towards the winner but keeps trying the others", () => {
    const stats = {
      flag_continuation: { n: 20, wins: 15, losses: 5, sumR: 6 },
      range_fade: { n: 20, wins: 6, losses: 14, sumR: -5 },
      engine: { n: 20, wins: 10, losses: 10, sumR: 0.5 },
    };
    const rand = seeded(42);
    const picks: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const s = pickStrategy(stats, rand);
      picks[s] = (picks[s] ?? 0) + 1;
    }
    // Untried ones still get picked (exploring); the winner beats the loser.
    expect(picks.flag_continuation ?? 0).toBeGreaterThan(picks.range_fade ?? 0);
    expect(Object.keys(picks).length).toBeGreaterThan(3);
  });

  it("marks a strategy down once it has lost money over enough trades", () => {
    const flat = () => 0.5;
    const losing = { n: RANDOM_MIN_TRADES, wins: 6, losses: 6, sumR: -1 };
    const even = { n: RANDOM_MIN_TRADES, wins: 6, losses: 6, sumR: 0.2 };
    expect(strategyScore(losing, flat)).toBeLessThan(strategyScore(even, flat) / 2);
  });

  it("asks for one setup by name, and tags the card with the strategy", () => {
    expect(strategyAsk("XAUUSD signal 5m", "engine")).toBe("XAUUSD signal 5m");
    expect(strategyAsk("XAUUSD signal 5m", "fvg_retest")).toBe("XAUUSD signal 5m setup:fvg_retest");
    const card = "🔴 I'm gonna sell ₿ BTC/USD now at 77397.70\n⏱ 15M · 💪 66%";
    expect(tagStrategy(card, "double_top_bottom")).toBe(
      "🔴 I'm gonna sell ₿ BTC/USD now at 77397.70\n⏱ 15M · 💪 66% · 🎲 Double top / bottom",
    );
    expect(strategyLines({ desk: { n: 4, wins: 3, losses: 1, sumR: 1.5 } })).toEqual([
      "AI desk: 3 of 4 won (+1.5R)",
    ]);
  });

  it("waits until it's due", async () => {
    const { maybeRandomSignal } = await import("./signal-broadcast.server");
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { value: "2099-01-01T00:00:00Z" } }),
          }),
        }),
      }),
    };
    const out = await maybeRandomSignal(admin, {
      build: async () => ({ reply: "" }),
      read: async () => ({ signal: { reply: "" }, desk: null }),
      post: async () => 1,
      now: () => Date.parse("2026-11-01T12:00:00Z"),
    });
    expect(out).toBe("not due");
  });
});
