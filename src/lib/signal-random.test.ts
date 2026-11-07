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

  it("ranks by money made, not win rate: small take profits can win often and still lose", async () => {
    const flat = () => 0.5;
    // Wins 60% but loses money (small wins, full losses) vs wins 45% and makes money.
    const busyLoser = { n: 20, wins: 12, losses: 8, sumR: -1.6 };
    const quietWinner = { n: 20, wins: 9, losses: 11, sumR: 2.5 };
    expect(strategyScore(quietWinner, flat)).toBeGreaterThan(strategyScore(busyLoser, flat));
  });

  it("learns from every signal the bot gives, not only random ones", async () => {
    const { strategyOf } = await import("./signal-random.server");
    expect(strategyOf({ strategy: "fvg_retest" })).toBe("fvg_retest");
    expect(strategyOf({ setup: "Flag continuation" })).toBe("flag_continuation");
    expect(strategyOf({ desk: "unanimous" })).toBe("desk");
    expect(strategyOf({ desk: "backed" })).toBe("engine");
    expect(strategyOf(null)).toBe("engine");
    expect(strategyOf({ strategy: "nonsense", setup: "Wick rejection" })).toBe("wick_rejection");
  });

  it("gives a random signal every 4 to 12 minutes (the Boss: more signals, free)", async () => {
    const { RANDOM_EVERY_MIN, RANDOM_MIN_CONFIDENCE } = await import("./signal-random.server");
    expect(RANDOM_EVERY_MIN).toEqual([4, 12]);
    expect(RANDOM_MIN_CONFIDENCE).toBe(60);
  });
});

describe("more signals that win more", () => {
  it("leans towards the charts making money", async () => {
    const { pickFrame } = await import("./signal-random.server");
    const stats = {
      "1m": { n: 30, wins: 10, losses: 20, sumR: -6 },
      "15m": { n: 30, wins: 20, losses: 10, sumR: 5 },
    };
    const rand = seeded(9);
    const picks: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const f = pickFrame(stats, rand);
      picks[f] = (picks[f] ?? 0) + 1;
    }
    expect(picks["15m"] ?? 0).toBeGreaterThan(picks["1m"] ?? 0);
  });

  it("tallies each chart from the stored timeframe", async () => {
    const { tallyFrames } = await import("./signal-random.server");
    const row = (timeframe: string, status: string) => ({
      direction: "BUY" as const,
      entry: 100,
      stop: 90,
      tp1: 108,
      status,
      best_target: status === "tp1" ? 1 : 0,
      feeds: null,
      timeframe,
    });
    const out = tallyFrames(
      [row("5M", "tp1"), row("5M", "stopped"), row("1H", "tp1"), row("4H", "tp1")],
      (r) => (r.best_target >= 1 ? 0.8 : -1),
    );
    expect(out["5m"]).toMatchObject({ n: 2, wins: 1, losses: 1 });
    expect(out["1h"]).toMatchObject({ n: 1, wins: 1 });
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("skips a quick signal against the 1-hour trend", async () => {
    const { againstTheHour } = await import("./signal-random.server");
    expect(againstTheHour("5m", "BUY", { direction: "SELL", confidencePct: 65 })).toBe(true);
    expect(againstTheHour("5m", "BUY", { direction: "SELL", confidencePct: 55 })).toBe(false);
    expect(againstTheHour("5m", "BUY", { direction: "BUY", confidencePct: 80 })).toBe(false);
    expect(againstTheHour("1h", "BUY", { direction: "SELL", confidencePct: 90 })).toBe(false);
    expect(againstTheHour("1m", "SELL", undefined)).toBe(false);
  });

  it("doesn't post when the hour reads the other way", async () => {
    const { maybeRandomSignal } = await import("./signal-broadcast.server");
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        }),
      }),
    };
    const post = vi.fn(async () => 1);
    const out = await maybeRandomSignal(admin, {
      build: async (ask: string) =>
        ask.endsWith("1h")
          ? { reply: "", plan: { direction: "SELL", confidencePct: 72 } }
          : {
              reply: "🟢 buy\n⏱ 1M · 💪 75%",
              plan: { market: "BTCUSD", direction: "BUY", confidencePct: 75 },
            },
      read: async () => ({ signal: { reply: "" }, desk: null }),
      post,
      now: () => Date.parse("2026-11-03T12:00:00Z"),
      rand: () => 0,
    } as never);
    expect(out).toBe("engine XAU 1m: against the 1h trend");
    expect(post).not.toHaveBeenCalled();
  });
});
