import { describe, expect, it } from "vitest";
import { POST_QUIET_MIN, postDecision } from "./signal-gate";
import { paperLines } from "./paper-account.server";

// Posted recently, so the safety valve isn't open.
const busy = { minutesSinceLastPost: 5 };

describe("the signals bot only posts what's most likely to win", () => {
  it("posts a sure alert with nothing against it", () => {
    expect(postDecision({ confidencePct: 75, ...busy })).toEqual({ post: true });
  });

  it("skips alerts under 70% unless calls like them have been winning", () => {
    expect(postDecision({ confidencePct: 64, ...busy })).toEqual({
      post: false,
      why: "only 64% sure",
    });
    expect(postDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 10, ...busy }).post).toBe(true);
    expect(postDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 3, ...busy }).post).toBe(false);
  });

  it("only a clearly losing band, strategy or chart is held back, not a small dip", () => {
    expect(postDecision({ confidencePct: 78, edge: -0.4, edgeTrades: 12, ...busy })).toEqual({
      post: false,
      why: "calls at 78% have been losing lately",
    });
    // Winning most trades with a take profit inside the stop can average a bit under zero.
    expect(postDecision({ confidencePct: 78, edge: -0.1, edgeTrades: 30, ...busy }).post).toBe(
      true,
    );
    const loser = { n: 15, wins: 4, losses: 11, sumR: -6 };
    expect(
      postDecision({ confidencePct: 80, strategy: loser, strategyName: "Range fade", ...busy }),
    ).toEqual({ post: false, why: "Range fade has been losing" });
    expect(
      postDecision({ confidencePct: 80, chart: loser, chartName: "1M chart", ...busy }),
    ).toEqual({ post: false, why: "the 1M chart has been losing" });
    const dip = { n: 15, wins: 9, losses: 6, sumR: -1 };
    expect(postDecision({ confidencePct: 80, strategy: dip, ...busy }).post).toBe(true);
    expect(postDecision({ confidencePct: 80, strategy: { ...loser, n: 5 }, ...busy }).post).toBe(
      true,
    );
  });

  it("never goes quiet: after a quiet spell the next alert goes out whatever its record", () => {
    const bad = { confidencePct: 62, edge: -0.8, edgeTrades: 20 };
    expect(postDecision({ ...bad, ...busy }).post).toBe(false);
    expect(postDecision({ ...bad, minutesSinceLastPost: POST_QUIET_MIN }).post).toBe(true);
    expect(postDecision({ ...bad, minutesSinceLastPost: null }).post).toBe(true);
  });

  it("says plainly on the card when the demo can't take a trade", () => {
    expect(paperLines(12.5, 0, "too little left to cover the stop")).toEqual([
      "💰 Test account balance: $12.50 · can't take this one: too little left to cover the stop",
    ]);
  });
});
