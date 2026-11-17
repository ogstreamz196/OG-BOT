import { describe, expect, it } from "vitest";
import {
  cleanRapid,
  RAPID_PER_ENTRY,
  RAPID_VARIANTS,
  rapidBoard,
  rapidGap,
  rapidResult,
  scoreRapid,
  type RapidMarket,
} from "./rapid-scalp";
import type { Sec } from "./micro-scalp";

const T0 = Date.parse("2026-11-17T00:00:00Z");
/** Seconds that drift up by `step` a second, each with a high/low wick of `wick`. */
function climb(n: number, step: number, wick = 0): Sec[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step;
    return { t: T0 + i * 1000, o: c - step, h: c + wick, l: c - wick, c };
  });
}

describe("rapid fire (2 trades every 3-5 seconds)", () => {
  it("gaps are 3, 4 or 5 seconds", () => {
    const gaps = new Set(Array.from({ length: 500 }, (_, i) => rapidGap(T0 + i * 1000)));
    expect([...gaps].sort()).toEqual([3, 4, 5]);
  });

  it("pays the spread: a small profit needs the price to move tp + 1 spreads", () => {
    const v = { tp: 0.5, sl: 3, maxHold: 60 };
    // Up 0.1 a second, spread 1: +1.5 needed, reached 15 seconds in.
    const up = climb(200, 0.1);
    expect(rapidResult(up, 10, 1, v, 1)).toEqual({ res: 0.5, at: up[25].t });
    // The other way: the stop at -3 is 2 spreads against, 20 seconds in.
    expect(rapidResult(up, 10, -1, v, 1)).toEqual({ res: -3, at: up[30].t });
    // Not enough candles yet: no result.
    expect(rapidResult(up, 150, 1, v, 1)).toBeNull();
  });

  it("opens 2 trades every 3-5 seconds with no open limit, each scored once", () => {
    const m: RapidMarket = { done: 0, next: 0, stats: {} };
    const secs = climb(1000, 0.05);
    const n = scoreRapid(m, secs, 1, "BTCUSD");
    const small = m.stats.small;
    expect(n).toBeGreaterThan(0);
    expect(small.n % RAPID_PER_ENTRY).toBe(0);
    // About one entry every 4 seconds over the scorable part.
    expect(small.n / RAPID_PER_ENTRY).toBeGreaterThan(100);
    // Several open at once: no cap.
    expect(small.peakOpen).toBeGreaterThan(RAPID_PER_ENTRY);
    // Following a steady climb, the small take profit wins.
    expect(small.wins).toBe(small.n);
    // Money at 0.01 lot of bitcoin (0.01 BTC): 0.5 spread x $1 x 0.01.
    expect(small.dollars).toBeCloseTo(small.n * 0.005, 5);
    // A second pass over the same window scores nothing new.
    expect(scoreRapid(m, secs, 1, "BTCUSD")).toBe(0);
  });

  it("the board ranks nothing proven until it beats the coin flip over 1000 trades", () => {
    const m: RapidMarket = { done: 0, next: 0, stats: {} };
    scoreRapid(m, climb(1000, 0.05), 1, "XAUUSD");
    const rows = rapidBoard(m);
    expect(rows.map((r) => r.id)).toEqual(RAPID_VARIANTS.map((v) => v.id));
    expect(rows.find((r) => r.id === "coin")?.proven).toBe(false);
    expect(rows.every((r) => r.n < 1000 || r.proven || r.perTrade <= 0)).toBe(true);
  });

  it("a stored scorecard is repaired, junk dropped", () => {
    const lab = cleanRapid({
      markets: {
        BTCUSD: { done: 5, next: 9, stats: { small: { n: 2, recent: [1, "x"] }, junk: {} } },
        "bad key": {},
      },
    });
    expect(Object.keys(lab.markets)).toEqual(["BTCUSD"]);
    expect(lab.markets.BTCUSD.stats.small.recent).toEqual([1]);
    expect(lab.markets.BTCUSD.stats.junk).toBeUndefined();
  });
});
