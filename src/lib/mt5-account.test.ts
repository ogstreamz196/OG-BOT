import { describe, expect, it } from "vitest";
import {
  drawdownPct,
  FRESH_MS,
  isFresh,
  mergeReport,
  mt5BalanceLine,
  parseAccount,
} from "./mt5-account.server";

const now = Date.parse("2026-11-11T21:00:00Z");
const demo = "VantageMarkets-Demo";

describe("the Boss's MT5 account (copier reports)", () => {
  it("keeps the peak, rising only, for the lot sizing's drawdown", () => {
    const a = mergeReport(
      null,
      { balance: 1000, equity: 1002, currency: "USD", server: demo },
      now,
    )!;
    expect(a).toMatchObject({ balance: 1000, equity: 1002, peak: 1000, at: now });
    const b = mergeReport(a, { balance: 1100, server: demo }, now + 1)!;
    expect(b.peak).toBe(1100);
    const c = mergeReport(b, { balance: 990, server: demo }, now + 2)!;
    expect(c.peak).toBe(1100);
    expect(drawdownPct(c)).toBeCloseTo(10, 6);
  });
  it("a different account (demo → real) starts its own peak", () => {
    const a = mergeReport(null, { balance: 5000, server: demo }, now)!;
    expect(mergeReport(a, { balance: 300, server: "VantageMarkets-Live" }, now)!.peak).toBe(300);
  });
  it("turns down a report with no usable balance", () => {
    expect(mergeReport(null, {}, now)).toBeNull();
    expect(mergeReport(null, { balance: "lots" }, now)).toBeNull();
    expect(mergeReport(null, { balance: -5 }, now)).toBeNull();
  });
  it("is offline once a report is FRESH_MS old", () => {
    const a = mergeReport(null, { balance: 1000, server: demo }, now)!;
    expect(isFresh(a, now + FRESH_MS - 1)).toBe(true);
    expect(isFresh(a, now + FRESH_MS)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });
  it("reads back what it stored, and nothing from junk", () => {
    const a = mergeReport(null, { balance: 1042.3, server: demo }, now)!;
    expect(parseAccount(JSON.stringify(a))).toEqual(a);
    expect(parseAccount("{oops")).toBeNull();
    expect(parseAccount(null)).toBeNull();
  });
  it("the results post's line says it's the MT5 account (and a demo)", () => {
    const a = mergeReport(null, { balance: 1042.3, server: demo }, now)!;
    expect(mt5BalanceLine(a)).toBe("💰 Balance: $1,042.30 · Vantage MT5 (demo)");
    const live = mergeReport(null, { balance: 1000, server: "VantageMarkets-Live" }, now)!;
    expect(mt5BalanceLine(live)).toBe("💰 Balance: $1,000 · Vantage MT5");
  });
});
