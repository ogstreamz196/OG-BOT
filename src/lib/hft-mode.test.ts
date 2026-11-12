import { describe, expect, it } from "vitest";
import { copierLot, hftBand } from "./copy-feed";
import {
  DEFAULT_ENGINE_CONFIG,
  hedgesPerMarket,
  hftConcurrency,
  rangeHedgesPerSide,
  stepEveryMs,
} from "./engine-config";
import { concurrencyBar, hedgeSideFor, rangeSidesFree } from "./signal-broadcast.server";

describe("high-frequency lots: bitcoin favoured, gold by balance", () => {
  it("leaves the chosen band alone when high-frequency is off", () => {
    expect(hftBand("small", false, "XAUUSD", 100)).toBe("small");
    expect(hftBand("medium", undefined, "BTCUSD", 100)).toBe("medium");
  });
  it("bitcoin always goes a notch bigger", () => {
    expect(hftBand("small", true, "BTCUSD", 50)).toBe("medium");
    expect(hftBand("medium", true, "BTCUSD", null)).toBe("large");
  });
  it("gold goes bigger from $400 and drops to the small band under it", () => {
    expect(hftBand("medium", true, "XAUUSD", 400)).toBe("large");
    expect(hftBand("small", true, "XAUUSD", 1000)).toBe("medium");
    expect(hftBand("large", true, "XAUUSD", 399.99)).toBe("small");
    expect(hftBand("medium", true, "XAUUSD", 120)).toBe("small");
  });
  it("gold keeps the chosen band when the balance isn't known", () => {
    expect(hftBand("medium", true, "XAUUSD", null)).toBe("medium");
    expect(hftBand("medium", true, "XAUUSD")).toBe("medium");
  });
  it("the copier's lot follows it", () => {
    const s = { lotBand: "medium" as const, hft: true };
    // Top confidence: the top of the band used.
    expect(copierLot(s, { botLots: 0.1, confidence: 90, market: "BTCUSD", balance: 100 })).toBe(
      0.5,
    );
    expect(copierLot(s, { botLots: 0.1, confidence: 90, market: "XAUUSD", balance: 100 })).toBe(
      0.05,
    );
    expect(copierLot(s, { botLots: 0.1, confidence: 90, market: "XAUUSD", balance: 500 })).toBe(
      0.5,
    );
  });
});

describe("high-frequency posting limits", () => {
  const c = hftConcurrency(DEFAULT_ENGINE_CONFIG.concurrency);
  it("no cap per market and no rising bar, shorter waits, same-setup rule kept", () => {
    expect(c.perMarket).toBe(Infinity);
    expect(concurrencyBar(40, c)).toBe(0);
    expect(c.sameSideGapMins).toBe(0.5);
    expect(c.afterStopMins).toBe(1);
    expect(c.sameSetupR).toBe(DEFAULT_ENGINE_CONFIG.concurrency.sameSetupR);
  });
  it("never lengthens a wait the Boss already set shorter", () => {
    const short = hftConcurrency({ ...DEFAULT_ENGINE_CONFIG.concurrency, sameSideGapMins: 0.2 });
    expect(short.sameSideGapMins).toBe(0.2);
  });
  it("off: one hedge a market, one range hedge a side, a chart read a minute", () => {
    expect(hedgesPerMarket(false)).toBe(1);
    expect(rangeHedgesPerSide(false)).toBe(1);
    expect(stepEveryMs(false)).toBe(60_000);
  });
  it("on: up to three hedges, never more than the trend trades", () => {
    const buy = { direction: "BUY" as const };
    const hedge = { direction: "SELL" as const, hedge: true };
    expect(hedgeSideFor([buy, hedge])).toBeNull();
    expect(hedgeSideFor([buy, hedge], hedgesPerMarket(true))).toBeNull();
    expect(hedgeSideFor([buy, buy, hedge], hedgesPerMarket(true))).toBe("SELL");
    expect(
      hedgeSideFor([buy, buy, buy, buy, hedge, hedge, hedge], hedgesPerMarket(true)),
    ).toBeNull();
  });
  it("on: two range hedges a side", () => {
    const r = { direction: "BUY" as const, rangeHedge: true };
    expect(rangeSidesFree([r])).toEqual(["SELL"]);
    expect(rangeSidesFree([r], rangeHedgesPerSide(true))).toEqual(["BUY", "SELL"]);
    expect(rangeSidesFree([r, r], rangeHedgesPerSide(true))).toEqual(["SELL"]);
  });
});
