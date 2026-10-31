import { describe, expect, it } from "vitest";
import {
  PAPER_BIG_LOT,
  PAPER_LOT,
  bigOne,
  paperLines,
  paperLots,
  paperPnl,
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

describe("lots", () => {
  it("0.1 a trade, 0.3 on an extremely confident quick scalp the AIs backed", () => {
    expect(bigOne({ confidencePct: 88, timeframe: "5M", desk: "backed" })).toBe(true);
    expect(bigOne({ confidencePct: 88, timeframe: "5M", desk: "unanimous" })).toBe(true);
    expect(bigOne({ confidencePct: 84, timeframe: "5M", desk: "backed" })).toBe(false);
    expect(bigOne({ confidencePct: 90, timeframe: "15M", desk: "backed" })).toBe(false);
    expect(bigOne({ confidencePct: 90, timeframe: "5M", desk: "no_ai" })).toBe(false);
    expect(paperLots("XAUUSD", 2650, 2645, 1000, false)).toBe(PAPER_LOT);
    expect(paperLots("XAUUSD", 2650, 2645, 1000, true)).toBe(PAPER_BIG_LOT);
  });
  it("never more than the balance could lose at the stop; nothing once it's blown", () => {
    // $5 stop on gold is $500 a lot: $100 left covers 0.2 lot.
    expect(paperLots("XAUUSD", 2650, 2645, 100, true)).toBe(0.2);
    expect(paperLots("XAUUSD", 2650, 2645, 0, false)).toBe(0);
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
  it("never filled, or breakeven: nothing", () => {
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
  it("the balance and lot on every card, and a word when it goes harder", () => {
    expect(paperLines(1000, 0.1, false)).toEqual([
      "💰 Test account balance: $1,000 · this trade 0.1 lot",
    ]);
    expect(paperLines(1043.5, 0.3, true)).toEqual([
      "🔥 I'm going harder on this one: 0.3 lot instead of 0.1",
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
  it("shows the balance and the change since the start", async () => {
    const { demoLine } = await import("./paper-account.server");
    expect(demoLine(1000, 1042.3)).toBe("📈 $1,000 DEMO: $1,042.30 (+$42.30 · +4.2%)");
    expect(demoLine(1000, 970)).toBe("📉 $1,000 DEMO: $970 (−$30 · −3.0%)");
    expect(demoLine(1000, 1000)).toBe("💰 $1,000 DEMO: $1,000 (+$0 · +0.0%)");
  });

  it("never shows .00 on a whole balance, but keeps real cents", async () => {
    const { demoLine } = await import("./paper-account.server");
    const line = demoLine(1000, 1000);
    expect(line).not.toContain(".00");
    expect(demoLine(1000, 999.5)).toContain("$999.50");
  });


  it("announces it once, as demo money and not advice", async () => {
    const { demoAnnouncement } = await import("./paper-account.server");
    const text = demoAnnouncement(1000);
    expect(text).toMatch(/^💸 PUTTING MY MONEY WHERE MY MOUTH IS/);
    expect(text).toContain("$1,000 demo Vantage Standard account");
    expect(text).toContain("counter carries on as it is");
    expect(text).toContain("not financial advice");
  });
});
