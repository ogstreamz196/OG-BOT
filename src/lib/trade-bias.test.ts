import { describe, expect, it } from "vitest";
import type { Candle } from "./trade-signal";
import { lotMoney, lotWin, marketBias, usdPerLotMove } from "./trade-bias";
import { cardToSend } from "./trade-signal-context.server";
import { winToastText } from "./trade-signal-tracker.server";

/** 5-minute candles drifting by `step` each bar, with a small range. */
function drift(n: number, start: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + step * i;
    return { t: i * 300_000, o: mid - step / 2, h: mid + 1, l: mid - 1, c: mid };
  });
}

describe("marketBias", () => {
  it("leans BUY on higher highs and lows, with stop below and targets above in order", () => {
    const recent = drift(36, 2000, 0.5);
    const price = recent.at(-1)!.c;
    const read = marketBias({ recent, price, prevDay: { h: 2010, l: 1990 }, lean: "SELL" })!;
    expect(read.direction).toBe("BUY");
    expect(read.reasons).toContain("higher highs and higher lows");
    expect(read.stop).toBeLessThan(read.entry);
    expect(read.targets[0]).toBeGreaterThan(read.entry);
    expect(read.targets[1]).toBeGreaterThan(read.targets[0]);
    expect(read.targets[2]).toBeGreaterThan(read.targets[1]);
  });

  it("leans SELL on lower highs and lows", () => {
    const recent = drift(36, 2000, -0.5);
    const price = recent.at(-1)!.c;
    const read = marketBias({ recent, price, prevDay: { h: 2010, l: 1990 }, lean: "BUY" })!;
    expect(read.direction).toBe("SELL");
    expect(read.stop).toBeGreaterThan(read.entry);
    expect(read.targets[2]).toBeLessThan(read.targets[1]);
    expect(read.targets[1]).toBeLessThan(read.targets[0]);
    expect(read.targets[0]).toBeLessThan(read.entry);
  });

  it("enters on a small break when it's close, else at market", () => {
    const recent = drift(36, 2000, 0.5);
    const last = recent.at(-1)!;
    const near = marketBias({ recent, price: last.h - 0.05, lean: "BUY" })!;
    expect(near.entryType).toBe("stop");
    expect(near.entry).toBeGreaterThan(last.h);
    const past = marketBias({ recent, price: last.h + 5, lean: "BUY" })!;
    expect(past.entryType).toBe("market");
    expect(past.entry).toBe(last.h + 5);
  });

  it("takes the desk's side when told to, with levels to match", () => {
    const recent = drift(36, 2000, 0.5);
    const read = marketBias({ recent, price: recent.at(-1)!.c, lean: "BUY", force: "SELL" })!;
    expect(read.direction).toBe("SELL");
    expect(read.stop).toBeGreaterThan(read.entry);
    expect(read.targets[0]).toBeLessThan(read.entry);
    expect(read.reasons).toEqual([]);
  });

  it("needs enough chart to read", () => {
    expect(marketBias({ recent: drift(5, 2000, 1), price: 2005, lean: "BUY" })).toBeNull();
  });
});

describe("1.0 lot on $500", () => {
  it("knows the standard contract sizes", () => {
    expect(usdPerLotMove("XAUUSD", 2400)).toBe(100);
    expect(usdPerLotMove("BTCUSD", 90000)).toBe(1);
    expect(usdPerLotMove("EURUSD", 1.1)).toBe(100_000);
    expect(usdPerLotMove("USDJPY", 150)).toBeCloseTo(666.67, 1);
    expect(usdPerLotMove("US30", 40000)).toBeNull();
  });
  it("works out a gold win at 0.5 lot (a $3 move is $150)", () => {
    expect(lotWin("XAUUSD", "BUY", 2400, 2403)).toEqual({ profit: 150, balance: 650, pct: 30 });
    expect(lotWin("XAUUSD", "SELL", 2400, 2397)).toEqual({ profit: 150, balance: 650, pct: 30 });
    expect(lotMoney("XAUUSD", 2400, 2396.7)).toBeCloseTo(165, 6);
    expect(lotMoney("BTCUSD", 80100, 80167.53)).toBeCloseTo(33.765, 6);
    expect(lotMoney("US30", 40000, 40100)).toBeNull();
  });
  it("says nothing for a losing move", () => {
    expect(lotWin("BTCUSD", "BUY", 90000, 89900)).toBeNull();
  });
});

describe("win toast", () => {
  const row = {
    market: "XAUUSD",
    label: "XAU/USD (Gold)",
    direction: "BUY" as const,
    entry: 2400,
    tp1: 2403,
    tp2: 2406,
    tp3: 2410,
    feeds: { bias: true, requester: { id: 42, name: "Kez" } },
  };
  it("names the person who asked and gives plain figures, no working", () => {
    const t = winToastText(row, "tp1", lotWin)!;
    expect(t.text).toBe(
      "💰 Kez, that market bias call just hit the Quick Scalp! At 0.5 lot that's $150.00 in the bag. Lucky bastard.",
    );
    expect(t.text.slice(t.mention.offset, t.mention.offset + t.mention.length)).toBe("Kez");
    expect(t.mention.id).toBe(42);
  });
  it("needs someone to tell and a contract size it knows", () => {
    expect(winToastText({ ...row, feeds: {} }, "tp1", lotWin)).toBeNull();
    expect(winToastText({ ...row, market: "US30" }, "tp1", lotWin)).toBeNull();
  });
});

describe("cardToSend", () => {
  const plan = { market: "XAUUSD" } as never;
  it("prefers the real signal, then the bias call, then the no-signal card", () => {
    expect(cardToSend({ block: "", expiresAt: null, reply: "SIG", plan })).toEqual({
      reply: "SIG",
      plan,
    });
    expect(
      cardToSend({ block: "", expiresAt: null, reply: "WAIT", bias: plan, biasReply: "BIAS" }),
    ).toEqual({ reply: "BIAS", plan });
    expect(cardToSend({ block: "", expiresAt: null, reply: "WAIT" })).toEqual({ reply: "WAIT" });
  });
});
