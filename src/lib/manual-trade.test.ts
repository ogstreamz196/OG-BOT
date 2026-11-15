import { describe, expect, it } from "vitest";
import {
  buildManualTrade,
  clampSl,
  clampTp,
  manualLot,
  MAX_MANUAL_LOT,
  CONTRACT_VALUE,
} from "./manual-trade";

describe("manual trade sizing", () => {
  it("sizes gold tighter than bitcoin by default distances", () => {
    // Gold's clamp range is far tighter than bitcoin's.
    expect(clampSl("XAUUSD", 1000)).toBe(30); // gold max 30
    expect(clampSl("BTCUSD", 100000)).toBe(3000); // bitcoin max 3000
    expect(clampTp("XAUUSD", 0.01)).toBe(0.5); // gold min 0.5
  });

  it("turns account risk into a lot using the contract value (round down)", () => {
    // Gold: $10,000 balance, risk 1% = $100, stop $5 => $5*100 = $500/lot => 0.2 lot.
    expect(manualLot("XAUUSD", 10_000, 1, 5)).toBe(0.2);
    // Bitcoin: $10,000, risk 1% = $100, stop $500 => $500*1 = $500/lot => 0.2 lot.
    expect(manualLot("BTCUSD", 10_000, 1, 500)).toBe(0.2);
    expect(CONTRACT_VALUE.XAUUSD).toBe(100);
  });

  it("never risks more than asked and caps the lot", () => {
    // A tiny stop would blow the lot up; it's capped.
    expect(manualLot("BTCUSD", 1_000_000, 50, 50)).toBe(MAX_MANUAL_LOT);
    // Too little to open even 0.01.
    expect(manualLot("XAUUSD", 1, 1, 5)).toBe(0);
  });

  it("builds a buy with stop below and target above, risk sized", () => {
    const t = buildManualTrade({
      market: "XAUUSD",
      direction: "BUY",
      price: 2000,
      slDistance: 5,
      tpDistance: 10,
      riskPct: 1,
      balance: 10_000,
    })!;
    expect(t.entry).toBe(2000);
    expect(t.stop).toBe(1995);
    expect(t.tp).toBe(2010);
    expect(t.lot).toBe(0.2);
    expect(t.lotFrom).toBe("risk");
    expect(t.riskAmount).toBe(100); // 0.2 lot * $5 * 100
    expect(t.rr).toBe(2);
  });

  it("builds a sell with a fixed lot (stop above, target below)", () => {
    const t = buildManualTrade({
      market: "BTCUSD",
      direction: "SELL",
      price: 60000,
      slDistance: 300,
      tpDistance: 900,
      lot: 0.1,
    })!;
    expect(t.stop).toBe(60300);
    expect(t.tp).toBe(59100);
    expect(t.lot).toBe(0.1);
    expect(t.lotFrom).toBe("fixed");
    expect(t.riskAmount).toBeNull();
    expect(t.rr).toBe(3);
  });

  it("is null when there is no usable lot", () => {
    expect(
      buildManualTrade({
        market: "XAUUSD",
        direction: "BUY",
        price: 2000,
        slDistance: 5,
        tpDistance: 10,
      }),
    ).toBeNull();
  });
});
