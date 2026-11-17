import { describe, expect, it } from "vitest";
import { COPY_RISK_PCT, copierLot, riskCapLot } from "./copy-feed";

describe("copied lots are capped so a stop can't wipe the account", () => {
  it("the Boss's case: large band, HFT, gold, $1,000: 0.5 lot becomes 0.01", () => {
    // 0.5 lot of gold with a $7 stop loses $350, 35% of $1,000.
    const lot = copierLot(
      { lotBand: "large", hft: true },
      { botLots: 0.3, market: "XAUUSD", balance: 1000, entry: 4000, stop: 3993, confidence: 80 },
    );
    // 1% of $1,000 = $10; $7 x 100 oz = $700 a lot, so 0.014 → 0.01.
    expect(lot).toBe(0.01);
    expect(lot * 7 * 100).toBeLessThanOrEqual(1000 * (COPY_RISK_PCT.hft / 100));
  });

  it("bitcoin: 2% normally, 1% in high-frequency mode", () => {
    const sig = { botLots: 0.3, market: "BTCUSD", balance: 1000, entry: 65000, stop: 64700 };
    // $20 / $300 a lot = 0.066 → 0.06; $10 / $300 = 0.033 → 0.03.
    expect(copierLot({ lotBand: "large" }, { ...sig, confidence: 90 })).toBe(0.06);
    expect(copierLot({ lotBand: "large", hft: true }, sig)).toBe(0.03);
  });

  it("a lot already inside the cap is left alone", () => {
    const lot = copierLot(
      { lotBand: "small" },
      {
        botLots: 0.3,
        market: "BTCUSD",
        balance: 10_000,
        entry: 65000,
        stop: 64900,
        confidence: 55,
      },
    );
    expect(lot).toBe(0.01);
  });

  it("the Boss's manual trade keeps its own lot", () => {
    expect(
      copierLot(
        { lotBand: "large", hft: true },
        { botLots: 0.2, manual: true, market: "XAUUSD", balance: 1000, entry: 4000, stop: 3990 },
      ),
    ).toBe(0.2);
  });

  it("no stop or balance known: no cap; never under 0.01", () => {
    expect(riskCapLot({ market: "XAUUSD", entry: 4000, balance: 1000 })).toBeNull();
    expect(riskCapLot({ market: "XAUUSD", entry: 4000, stop: 3990, balance: null })).toBeNull();
    expect(riskCapLot({ market: "XAUUSD", entry: 4000, stop: 3900, balance: 100 })).toBe(0.01);
    expect(riskCapLot({ market: "EURUSD", entry: 1, stop: 0.9, balance: 100 })).toBeNull();
  });
});
