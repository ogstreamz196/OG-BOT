import { describe, expect, it } from "vitest";
import { copyDecision } from "./copy-filter";
import { paperLines } from "./paper-account.server";

describe("the Copy Trader B0T is choosy", () => {
  it("copies a sure alert with nothing against it", () => {
    expect(copyDecision({ confidencePct: 75 })).toEqual({ copy: true });
  });

  it("skips alerts under 70% unless calls like them have been winning", () => {
    expect(copyDecision({ confidencePct: 64 })).toEqual({ copy: false, why: "only 64% sure" });
    expect(copyDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 10 }).copy).toBe(true);
    // Too few calls to count as proven.
    expect(copyDecision({ confidencePct: 64, edge: 0.4, edgeTrades: 3 }).copy).toBe(false);
  });

  it("skips a confidence band, strategy or chart that has been losing", () => {
    expect(copyDecision({ confidencePct: 78, edge: -0.2, edgeTrades: 12 })).toEqual({
      copy: false,
      why: "calls at 78% have been losing lately",
    });
    const loser = { n: 15, wins: 6, losses: 9, sumR: -2 };
    expect(
      copyDecision({ confidencePct: 80, strategy: loser, strategyName: "Range fade" }),
    ).toEqual({ copy: false, why: "Range fade has been losing" });
    expect(copyDecision({ confidencePct: 80, chart: loser, chartName: "1M chart" })).toEqual({
      copy: false,
      why: "the 1M chart has been losing",
    });
    // A short losing record doesn't rule anything out yet.
    expect(copyDecision({ confidencePct: 80, strategy: { ...loser, n: 5 } }).copy).toBe(true);
  });

  it("after three losses in a row, only copies 80%+ until it wins again", () => {
    expect(copyDecision({ confidencePct: 75, lossStreak: 3 }).copy).toBe(false);
    expect(copyDecision({ confidencePct: 82, lossStreak: 3 }).copy).toBe(true);
    expect(copyDecision({ confidencePct: 75, lossStreak: 2 }).copy).toBe(true);
  });

  it("says plainly on the card when it isn't copying", () => {
    expect(paperLines(1004.2, 0, "only 64% sure")).toEqual([
      "💰 Test account balance: $1,004.20 · not copying this one: only 64% sure",
    ]);
  });
});
