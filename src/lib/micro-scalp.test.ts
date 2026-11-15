import { describe, expect, it } from "vitest";
import {
  cleanLab,
  emptyStats,
  ENTRY_DELAY,
  keyOf,
  microBoard,
  scoreWindow,
  tradeResult,
  WARMUP,
  type MicroMarketState,
  type Sec,
} from "./micro-scalp";

const flat = (n: number, p = 100, t0 = 1_000_000_000_000): Sec[] =>
  Array.from({ length: n }, (_, i) => ({
    t: t0 + i * 1000,
    o: p,
    h: p,
    l: p,
    c: p,
    v: 1,
    tb: 0.5,
  }));

describe("tradeResult (the spread paid honestly, stop before take profit)", () => {
  const cost = 1;
  // At 15 seconds: take profit +2 spreads, stop -1.5 spreads (after costs).
  it("a take profit of 2 spreads needs the price to move 3 (the spread comes off)", () => {
    const near = flat(40);
    near[5] = { ...near[5], h: 102.99 };
    expect(tradeResult(near, 0, 1, 15, cost)).not.toBe(2);
    const hit = flat(40);
    hit[5] = { ...hit[5], h: 103 };
    expect(tradeResult(hit, 0, 1, 15, cost)).toBe(2);
  });
  it("a 1.5-spread stop is hit once the price moves half a spread against it", () => {
    const s = flat(40);
    s[3] = { ...s[3], l: 99.5 };
    expect(tradeResult(s, 0, 1, 15, cost)).toBe(-1.5);
    const safe = flat(40);
    safe[3] = { ...safe[3], l: 99.51 };
    expect(tradeResult(safe, 0, 1, 15, cost)).toBe(-1); // closes on time: just the spread
  });
  it("sells are mirrored", () => {
    const s = flat(40);
    s[5] = { ...s[5], l: 97 };
    expect(tradeResult(s, 0, -1, 15, cost)).toBe(2);
  });
  it("both in the same second counts as the stop", () => {
    const s = flat(40);
    s[3] = { ...s[3], h: 104, l: 99 };
    expect(tradeResult(s, 0, 1, 15, cost)).toBe(-1.5);
  });
  it("nothing happens: closes on time and still pays the spread", () => {
    expect(tradeResult(flat(40), 0, -1, 15, cost)).toBe(-1);
  });
  it("not enough candles yet: no result", () => {
    expect(tradeResult(flat(10), 0, 1, 15, cost)).toBeNull();
  });
});

describe("scoreWindow", () => {
  // A steady climb: the breakout fires every second once warmed up.
  const climb = (n: number, t0?: number): Sec[] =>
    flat(n, 100, t0).map((s, i) => {
      const p = 100 + i * 0.5;
      return { ...s, o: p, h: p + 0.1, l: p - 0.1, c: p };
    });

  it("scores trades once, even when windows overlap", () => {
    const secs = climb(1600);
    const a: MicroMarketState = { done: {}, stats: {} };
    scoreWindow(a, secs.slice(0, 1000), 1);
    scoreWindow(a, secs.slice(60, 1060), 1);
    scoreWindow(a, secs.slice(60, 1060), 1); // the same window again: nothing new
    const b: MicroMarketState = { done: {}, stats: {} };
    scoreWindow(b, secs.slice(0, 1000), 1);
    scoreWindow(b, secs.slice(60, 1060), 1);
    expect(a.stats).toEqual(b.stats);
  });

  it("one trade at a time per strategy and hold", () => {
    const st: MicroMarketState = { done: {}, stats: {} };
    scoreWindow(st, climb(1000), 1);
    const b15 = st.stats[keyOf("breakout_60s", 15)];
    // About (1000 - WARMUP - 15 - delay) seconds open, one trade per 15 + delay seconds.
    expect(b15.n).toBeGreaterThan(15);
    expect(b15.n).toBeLessThanOrEqual(Math.ceil((1000 - WARMUP - 15) / (15 + ENTRY_DELAY)) + 1);
    // A steady climb: the breakout wins and the fade loses, every time.
    expect(b15.wins).toBe(b15.n);
    expect(b15.bestWinStreak).toBe(b15.n);
    const fade = st.stats[keyOf("fade_breakout_60s", 15)];
    expect(fade.losses).toBe(fade.n);
    expect(fade.worstLossStreak).toBe(fade.n);
    expect(fade.streak).toBe(-fade.n);
  });

  it("needs the warm-up first", () => {
    const st: MicroMarketState = { done: {}, stats: {} };
    expect(scoreWindow(st, climb(WARMUP), 1)).toBe(0);
  });
});

describe("cleanLab and microBoard", () => {
  it("repairs junk and keeps only known strategies", () => {
    const lab = cleanLab({
      markets: {
        XAUUSD: {
          done: { "15": 5, "999": 1 },
          stats: { "breakout_60s@15": { n: "x", wins: 2 }, "evil@15": { n: 9 } },
        },
        "bad market": {},
      },
    });
    expect(Object.keys(lab.markets)).toEqual(["XAUUSD"]);
    expect(lab.markets.XAUUSD.done).toEqual({ 15: 5 });
    expect(lab.markets.XAUUSD.stats["breakout_60s@15"]).toMatchObject({ n: 0, wins: 2 });
    expect(lab.markets.XAUUSD.stats["evil@15"]).toBeUndefined();
  });

  it("ranks by money after the spread and only calls a strategy proven when it really is", () => {
    const st = (n: number, spreads: number, recent: number[]) => ({
      ...emptyStats(),
      n,
      wins: n / 2,
      spreads,
      recent,
    });
    const m: MicroMarketState = {
      done: {},
      stats: {
        [keyOf("breakout_60s", 300)]: st(400, 60, [0.5, -0.2]),
        [keyOf("trend_pullback", 300)]: st(100, 40, [1]), // too few trades
        [keyOf("trend_momentum", 300)]: st(400, 50, [-1, -1]), // losing lately
        [keyOf("random", 300)]: st(400, -40, [-1]),
      },
    };
    const board = microBoard(m);
    expect(board[0].strategy).toBe("trend_pullback");
    const proven = board.filter((r) => r.proven).map((r) => r.strategy);
    expect(proven).toEqual(["breakout_60s"]);
  });
});
