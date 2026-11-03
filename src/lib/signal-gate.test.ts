import { describe, expect, it } from "vitest";
import { postDecision } from "./signal-gate";
import { paperLines } from "./paper-account.server";

describe("the signals bot only posts what's most likely to win", () => {
  it("posts a sure alert with nothing against it", () => {
    expect(postDecision({ confidencePct: 75 })).toEqual({ post: true });
  });

  it("skips alerts under 70% unless calls like them have been winning", () => {
    expect(postDecision({ confidencePct: 64 })).toEqual({ post: false, why: "only 64% sure" });
    expect(postDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 10 }).post).toBe(true);
    // Too few calls to count as proven.
    expect(postDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 3 }).post).toBe(false);
  });

  it("skips a confidence band, strategy or chart that has been losing", () => {
    expect(postDecision({ confidencePct: 78, edge: -0.2, edgeTrades: 12 })).toEqual({
      post: false,
      why: "calls at 78% have been losing lately",
    });
    const loser = { n: 15, wins: 6, losses: 9, sumR: -2 };
    expect(
      postDecision({ confidencePct: 80, strategy: loser, strategyName: "Range fade" }),
    ).toEqual({ post: false, why: "Range fade has been losing" });
    expect(postDecision({ confidencePct: 80, chart: loser, chartName: "1M chart" })).toEqual({
      post: false,
      why: "the 1M chart has been losing",
    });
    // A short losing record doesn't rule anything out yet.
    expect(postDecision({ confidencePct: 80, strategy: { ...loser, n: 5 } }).post).toBe(true);
  });

  it("after three losses in a row, only posts 80%+ until it wins again", () => {
    expect(postDecision({ confidencePct: 75, lossStreak: 3 }).post).toBe(false);
    expect(postDecision({ confidencePct: 82, lossStreak: 3 }).post).toBe(true);
    expect(postDecision({ confidencePct: 75, lossStreak: 2 }).post).toBe(true);
  });

  it("says plainly on the card when the demo can't take a trade", () => {
    expect(paperLines(12.5, 0, "too little left to cover the stop")).toEqual([
      "💰 Test account balance: $12.50 · can't take this one: too little left to cover the stop",
    ]);
  });
});
