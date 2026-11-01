import { describe, expect, it } from "vitest";
import {
  bigOne,
  chooseLot,
  confidenceBand,
  demoForm,
  paperLines,
  paperPnl,
  resultInRisks,
  parsePaper,
  rescaleCardMoney,
} from "./paper-account.server";
import { testModeNote } from "./signals-fresh-start.server";

// The $1,000 test account: lots, card lines and profit and loss worked out
// like a Vantage Standard STP account (spread only, no commission).

const gold = {
  market: "XAUUSD",
  direction: "BUY" as const,
  entry: 2650,
  stop: 2645,
  tp1: 2653,
  tp2: 2653,
  tp3: 2653,
  marketEntry: false,
  entered: true,
  status: "tp3",
  bestTarget: 3,
  lastPrice: null,
};

describe("lots: 0.05 to 0.3 in 0.05 steps, learned from wins and losses", () => {
  // A $2 stop on gold is $200 a lot, so $1,000 at 5% covers up to 0.25 lot.
  const base = {
    market: "XAUUSD",
    entry: 2650,
    stop: 2648,
    balance: 1000,
    confidencePct: 72,
    big: false,
  };
  it("starts from how sure it is", () => {
    expect(bigOne({ confidencePct: 88, timeframe: "5M", desk: "backed" })).toBe(true);
    expect(bigOne({ confidencePct: 90, timeframe: "15M", desk: "backed" })).toBe(false);
    expect(chooseLot(base).lots).toBe(0.1);
    expect(chooseLot({ ...base, confidencePct: 78 }).lots).toBe(0.15);
    expect(chooseLot({ ...base, confidencePct: 86 }).lots).toBe(0.2);
    expect(chooseLot({ ...base, confidencePct: 88, big: true }).lots).toBe(0.25);
  });
  it("goes bigger where calls like it have been paying, up to 0.3 and never past it", () => {
    const btc = { ...base, market: "BTCUSD", entry: 70000, stop: 69900 };
    expect(chooseLot({ ...btc, confidencePct: 78, edge: 0.6, edgeTrades: 12 }).lots).toBe(0.2);
    const top = chooseLot({ ...btc, confidencePct: 88, big: true, edge: 1.2, edgeTrades: 20 });
    expect(top.lots).toBe(0.3);
    expect(top.why).toContain("20 calls like it averaged +1.2R");
    expect(paperLines(1000, top.lots)[0]).toContain("0.3 lot, my limit");
  });
  it("ignores a record with too few calls in it", () => {
    expect(chooseLot({ ...base, edge: 2, edgeTrades: 5 }).lots).toBe(0.1);
  });
  it("goes smaller where calls like it have been losing, and after losses", () => {
    expect(chooseLot({ ...base, edge: -0.1, edgeTrades: 10 }).lots).toBe(0.05);
    expect(chooseLot({ ...base, confidencePct: 86, edge: -0.5, edgeTrades: 10 }).lots).toBe(0.1);
    const streak = chooseLot({ ...base, confidencePct: 86, lossStreak: 3 });
    expect(streak.lots).toBe(0.1);
    expect(streak.why).toContain("3 losses in a row");
    expect(chooseLot({ ...base, confidencePct: 86, drawdownPct: 12 }).lots).toBe(0.15);
    // Never below the smallest lot.
    expect(chooseLot({ ...base, edge: -1, edgeTrades: 10, lossStreak: 5 }).lots).toBe(0.05);
  });
  it("keeps the stop's loss within 5% of the balance, the smallest lot aside", () => {
    // $5 stop: $500 a lot, so $1,000 at 5% is 0.1 lot even at 88%.
    const wide = chooseLot({ ...base, stop: 2645, confidencePct: 88, big: true });
    expect(wide.lots).toBe(0.1);
    expect(wide.why).toContain("5% at most");
    expect(chooseLot({ ...base, stop: 2645, balance: 300 }).lots).toBe(0.05);
    expect(chooseLot({ ...base, stop: 2600, balance: 100 }).lots).toBe(0);
    expect(chooseLot({ ...base, balance: 0 }).lots).toBe(0);
  });
  it("reads results in risks, the profit lock as a small win", () => {
    const row = { direction: "BUY" as const, entry: 100, stop: 98, tp1: 104, best_target: 0 };
    expect(resultInRisks({ ...row, status: "tp3", best_target: 3 })).toBe(2);
    expect(resultInRisks({ ...row, status: "stopped" })).toBe(-1);
    expect(resultInRisks({ ...row, status: "breakeven", feeds: { lock: true } })).toBeCloseTo(0.6);
    expect(resultInRisks({ ...row, status: "breakeven" })).toBe(0);
    expect(resultInRisks({ ...row, status: "unfilled" })).toBeNull();
    expect(confidenceBand(77)).toEqual([75, 80]);
  });
  it("the demo's form: losses in a row and the drop from its best", () => {
    expect(demoForm(1000, [50, -20, -30])).toEqual({
      lossStreak: 2,
      drawdownPct: (50 / 1050) * 100,
    });
    expect(demoForm(1000, [-10, 40])).toEqual({ lossStreak: 0, drawdownPct: 0 });
  });
});

describe("profit and loss (Standard STP)", () => {
  it("a take profit pays its level; a stop costs its level", () => {
    // 0.1 lot of gold: $10 a dollar.
    expect(paperPnl(gold, 0.1, 0.3)).toBe(30);
    expect(paperPnl({ ...gold, status: "stopped", bestTarget: 0 }, 0.1, 0.3)).toBe(-50);
    expect(paperPnl(gold, 0.3, 0.3)).toBe(90);
  });
  it("a market entry pays half the spread on top", () => {
    expect(paperPnl({ ...gold, marketEntry: true }, 0.1, 0.3)).toBe(28.5);
  });
  it("closed on time: out at the bid, half a spread under the last price", () => {
    expect(paperPnl({ ...gold, status: "expired", bestTarget: 0, lastPrice: 2651 }, 0.1, 0.3)).toBe(
      8.5,
    );
  });
  it("the profit lock banks 30% of the way to the take profit", () => {
    // Lock stop 2650.90 on a 2653 take profit: +$9 on 0.1 lot.
    expect(
      paperPnl({ ...gold, status: "breakeven", bestTarget: 0, lockStop: 2650.9 }, 0.1, 0.3),
    ).toBe(9);
    const runner = { ...gold, tp2: 2656, tp3: 2656, lockStop: 2650.9 };
    // A third at 2653 (+$30) and the rest at the lock (+$18) on 0.3 lot.
    expect(paperPnl({ ...runner, status: "breakeven", bestTarget: 1 }, 0.3, 0.3)).toBe(48);
  });
  it("never filled, or an older breakeven: nothing", () => {
    expect(paperPnl({ ...gold, status: "unfilled", bestTarget: 0, entered: false }, 0.1, 0.3)).toBe(
      0,
    );
    expect(paperPnl({ ...gold, status: "breakeven", bestTarget: 0 }, 0.1, 0.3)).toBe(0);
  });
  it("a runner banks a third at the first target, the rest at the runner or the entry", () => {
    const runner = { ...gold, tp2: 2656, tp3: 2656 };
    expect(paperPnl({ ...runner, status: "tp3", bestTarget: 3 }, 0.3, 0.3)).toBe(150);
    expect(paperPnl({ ...runner, status: "breakeven", bestTarget: 1 }, 0.3, 0.3)).toBe(30);
  });
  it("bitcoin: 0.1 lot is $0.10 a dollar", () => {
    const btc = {
      ...gold,
      market: "BTCUSD",
      entry: 70000,
      stop: 69500,
      tp1: 70400,
      tp2: 70400,
      tp3: 70400,
    };
    expect(paperPnl(btc, 0.1, 15)).toBe(40);
  });
});

describe("card lines", () => {
  it("the balance, lot and why on every card, and a word at the limit", () => {
    expect(paperLines(1000, 0.1, "72% sure")).toEqual([
      "💰 Test account balance: $1,000 · this trade 0.1 lot",
      "📏 Why 0.1: 72% sure",
    ]);
    expect(paperLines(1043.5, 0.3)).toEqual([
      "🔥 I'm going hard on this one: 0.3 lot, my limit",
      "💰 Test account balance: $1,043.50 · this trade 0.3 lot",
    ]);
  });

  it("the card's dollar figures follow the lot", () => {
    const card =
      "🛑 My stop loss will be 2645.00 · −$250.00\n🎯 I'll take profit at 2653.00 · +$150.00";
    expect(rescaleCardMoney(card, 0.5, 0.1)).toBe(
      "🛑 My stop loss will be 2645.00 · −$50.00\n🎯 I'll take profit at 2653.00 · +$30.00",
    );
  });
  it("the test-mode note and saved state", () => {
    expect(testModeNote(1000)).toMatch(/\$1,000 on a fresh Vantage Standard account/);
    expect(parsePaper('{"start":1000,"startedAt":"2026-10-31T12:00:00Z"}')).toEqual({
      start: 1000,
      startedAt: "2026-10-31T12:00:00Z",
    });
    expect(parsePaper("nope")).toBeNull();
  });
});

describe("the $1,000 demo shown to everyone", () => {
  it("shows just the balance, no starting amount", async () => {
    const { demoLine } = await import("./paper-account.server");
    expect(demoLine(1000, 1042.3)).toBe("💰 Balance: $1,042.30");
    expect(demoLine(1000, 1000)).toBe("💰 Balance: $1,000");
  });

  it("announces it once, as demo money and not advice", async () => {
    const { demoAnnouncement } = await import("./paper-account.server");
    const text = demoAnnouncement(1000);
    expect(text).toMatch(/^💸 PUTTING MY MONEY WHERE MY MOUTH IS/);
    expect(text).toContain("$1,000 demo Vantage account");
    expect(text).toContain("Counter carries on.");
    expect(text).toContain("Not financial advice");
    expect(text.split("\n")).toHaveLength(3);
    const fresh = demoAnnouncement(1000, true);
    expect(fresh).toContain("Counter from zero.");
    expect(fresh).not.toContain("carries on");
  });
});

describe("the results post adds up", () => {
  const row = (market: string, closed: string, pnl: number | undefined, lots = 0.05) => ({
    market,
    closed_at: closed,
    feeds: { paper: { lots, ...(pnl != null ? { pnl } : {}) } },
  });
  it("counts wins and losses from the demo's own money, so they match the balance", async () => {
    const { demoTally } = await import("./paper-account.server");
    const t = demoTally(1000, [
      row("BTCUSD", "2026-10-31T21:00:00Z", 2.06),
      row("BTCUSD", "2026-10-31T17:50:00Z", -4.65),
      row("XAUUSD", "2026-10-31T18:30:00Z", 1.2),
      // Still running, never filled and a 0-lot alert don't count.
      row("BTCUSD", "", undefined),
      row("BTCUSD", "2026-10-31T19:00:00Z", 0),
      row("BTCUSD", "2026-10-31T19:30:00Z", -50, 0),
    ]);
    expect(t).toEqual({
      balance: 998.61,
      wins: 2,
      losses: 1,
      form: ["lost", "won", "won"],
      byMarket: { BTCUSD: -2.59, XAUUSD: 1.2 },
    });
    // The balance is always the start plus each market.
    const sum = Object.values(t.byMarket).reduce((a, b) => a + b, 0);
    expect(Math.round((1000 + sum) * 100) / 100).toBe(t.balance);
  });
});

describe("the Copy Trader B0T's live tally", () => {
  it("lists each trade it's copying, waiting or with the money so far", async () => {
    const { copyingLine } = await import("./paper-account.server");
    const base = {
      market: "BTCUSD",
      direction: "SELL" as const,
      entry: 77397.7,
      feeds: { paper: { lots: 0.1 } },
    };
    expect(copyingLine({ ...base, status: "pending", last_price: null })).toBe(
      "📋 ₿ BTC SELL 0.1 lot · waiting for entry",
    );
    expect(copyingLine({ ...base, status: "open", last_price: 77372.4 })).toBe(
      "📋 ₿ BTC SELL 0.1 lot · +$2.53 so far",
    );
    expect(copyingLine({ ...base, status: "open", last_price: null, feeds: null })).toBeNull();
  });

  it("posts the tally under its own name, with what it's copying on top", async () => {
    const { resultsAnnouncement } = await import("./signal-record.server");
    const text = resultsAnnouncement(
      {
        since: null,
        signals: 3,
        wins: 2,
        losses: 1,
        running: 1,
        cancelled: 0,
        markets: [],
        form: ["lost", "won", "won"],
      },
      "💰 Balance: $1,009.30",
      { BTCUSD: 9.3 },
      { copying: ["📋 ₿ BTC SELL 0.1 lot · +$2.53 so far"] },
    );
    expect(text.split("\n").slice(0, 3)).toEqual([
      "📋 COPY TRADER B0T",
      "📋 ₿ BTC SELL 0.1 lot · +$2.53 so far",
      "🔥 2 wins in a row",
    ]);
    expect(text).toMatch(/💰 Balance: \$1,009\.30$/);
    expect(text).not.toMatch(/OG TRADE BOT|My boy/);
  });
});
