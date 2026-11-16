import { describe, expect, it } from "vitest";
import { balanceHeader, copierBalance, copierLot, hftLotSpot } from "./copy-feed";
import {
  DEFAULT_ENGINE_CONFIG,
  hedgesPerMarket,
  hedgingOn,
  hftConcurrency,
  rangeHedgesPerSide,
  stepEveryMs,
} from "./engine-config";
import { concurrencyBar, hedgeSideFor, rangeSidesFree } from "./signal-broadcast.server";

describe("high-frequency lots stay inside the band set on the card", () => {
  it("off: the usual scaling by confidence", () => {
    expect(hftLotSpot(false, "BTCUSD", 1000)).toBeNull();
    expect(
      copierLot({ lotBand: "small" }, { botLots: 0.1, confidence: 55, market: "BTCUSD" }),
    ).toBe(0.01);
  });
  it("bitcoin takes the top of the band, whatever the balance or confidence", () => {
    const s = { lotBand: "small" as const, hft: true };
    expect(copierLot(s, { botLots: 0.1, confidence: 55, market: "BTCUSD", balance: 50 })).toBe(
      0.05,
    );
    expect(copierLot({ ...s, lotBand: "medium" }, { botLots: 0.1, market: "BTCUSD" })).toBe(0.1);
    expect(copierLot({ ...s, lotBand: "large" }, { botLots: 0.1, market: "BTCUSD" })).toBe(0.5);
  });
  it("gold takes the top from $400 and the bottom of the band under it", () => {
    const s = { lotBand: "medium" as const, hft: true };
    expect(copierLot(s, { botLots: 0.1, confidence: 60, market: "XAUUSD", balance: 400 })).toBe(
      0.1,
    );
    expect(copierLot(s, { botLots: 0.1, confidence: 90, market: "XAUUSD", balance: 399 })).toBe(
      0.02,
    );
    expect(
      copierLot({ ...s, lotBand: "small" }, { botLots: 0.1, market: "XAUUSD", balance: 100 }),
    ).toBe(0.01);
  });
  it("gold with no known balance scales by confidence inside the band", () => {
    const s = { lotBand: "medium" as const, hft: true };
    expect(hftLotSpot(true, "XAUUSD", null)).toBeNull();
    expect(copierLot(s, { botLots: 0.1, confidence: 90, market: "XAUUSD" })).toBe(0.1);
    expect(copierLot(s, { botLots: 0.1, confidence: 55, market: "XAUUSD" })).toBe(0.02);
  });
});

describe("high-frequency posting limits", () => {
  const c = hftConcurrency(DEFAULT_ENGINE_CONFIG.concurrency);
  it("no cap per market and no rising bar, shorter waits, same-setup rule kept", () => {
    expect(c.perMarket).toBe(Infinity);
    expect(concurrencyBar(40, c)).toBe(0);
    expect(c.sameSideGapMins).toBe(0.25);
    expect(c.afterStopMins).toBe(0.5);
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
    expect(stepEveryMs(true)).toBe(10_000);
  });
  it("on: up to five hedges, two per trend trade", () => {
    const buy = { direction: "BUY" as const };
    const hedge = { direction: "SELL" as const, hedge: true };
    expect(hedgesPerMarket(true)).toBe(5);
    // Off: one per trend trade.
    expect(hedgeSideFor([buy, hedge])).toBeNull();
    // On: a second hedge on one trend trade, never a third.
    expect(hedgeSideFor([buy, hedge], hedgesPerMarket(true), true)).toBe("SELL");
    expect(hedgeSideFor([buy, hedge, hedge], hedgesPerMarket(true), true)).toBeNull();
    expect(hedgeSideFor([buy, buy, buy, hedge, hedge, hedge, hedge], 5, true)).toBe("SELL");
    expect(hedgeSideFor([buy, buy, buy, hedge, hedge, hedge, hedge, hedge], 5, true)).toBeNull();
  });
  it("on: trades both ways are hedged against the side with more", () => {
    const buy = { direction: "BUY" as const };
    const sell = { direction: "SELL" as const };
    expect(hedgeSideFor([buy, buy, sell])).toBeNull();
    expect(hedgeSideFor([buy, buy, sell], 5, true)).toBe("SELL");
    expect(hedgeSideFor([sell, sell, buy], 5, true)).toBe("BUY");
    expect(hedgeSideFor([buy, sell], 5, true)).toBeNull();
    expect(hedgeSideFor([], 5, true)).toBeNull();
  });
  it("on: hedging and range hedging run without their own switches", () => {
    expect(hedgingOn(false, false)).toBe(false);
    expect(hedgingOn(undefined, true)).toBe(true);
    expect(hedgingOn(true, false)).toBe(true);
  });
  it("on: three range hedges a side", () => {
    const r = { direction: "BUY" as const, rangeHedge: true };
    expect(rangeSidesFree([r])).toEqual(["SELL"]);
    expect(rangeSidesFree([r, r], rangeHedgesPerSide(true))).toEqual(["BUY", "SELL"]);
    expect(rangeSidesFree([r, r, r], rangeHedgesPerSide(true))).toEqual(["SELL"]);
  });
});

describe("the copier's reported balance", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const row = (balance: unknown, minsAgo: number) =>
    JSON.stringify({ balance, at: new Date(now - minsAgo * 60_000).toISOString() });
  it("reads a sane header and drops junk", () => {
    expect(balanceHeader("412.337")).toBe(412.34);
    expect(balanceHeader("0")).toBe(0);
    expect(balanceHeader("-5")).toBeNull();
    expect(balanceHeader("abc")).toBeNull();
    expect(balanceHeader(null)).toBeNull();
  });
  it("is used while fresh and ignored once the copier's been off 15 minutes", () => {
    expect(copierBalance(row(350, 2), now)).toBe(350);
    expect(copierBalance(row(350, 16), now)).toBeNull();
    expect(copierBalance("not json", now)).toBeNull();
    expect(copierBalance(null, now)).toBeNull();
  });
});
