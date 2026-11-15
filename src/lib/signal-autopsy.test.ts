import { describe, expect, it } from "vitest";
import {
  autopsyBoard,
  cleanAutopsy,
  emptyTally,
  entryGap,
  lossAutopsy,
  type Candle1m,
} from "./signal-autopsy";

// A buy at 100, stop 99 (risk 1), first target 102. Stop hit at minute 5.
const base = {
  direction: "BUY" as const,
  entry: 100,
  stop: 99,
  tp1: 102,
  enteredAt: 0,
  closedAt: 5 * 60_000,
  lookMs: 60 * 60_000,
};
const path = (lows: number[], highs: number[]): Candle1m[] =>
  lows.map((l, i) => ({ t: i * 60_000, l, h: highs[i], c: (l + highs[i]) / 2 }));

describe("lossAutopsy", () => {
  it("stop was the entry: just past the stop, then the target", () => {
    // Dips to 98.7 (0.3 R past the stop) at minute 5, then runs to 102.
    const c = path(
      [99.8, 99.6, 99.4, 99.2, 99.1, 98.7, 99.5, 100.5, 101.5],
      [100.2, 100, 99.8, 99.6, 99.4, 99.2, 100.5, 101.5, 102.1],
    );
    expect(lossAutopsy({ ...base, candles: c })).toBe("stop_was_entry");
  });
  it("stop too tight: well past the stop, then still the target", () => {
    const c = path(
      [99.8, 99.6, 99.4, 99.2, 99.1, 97.9, 99, 100.5, 101.5],
      [100.2, 100, 99.8, 99.6, 99.4, 99, 100.5, 101.5, 102.1],
    );
    expect(lossAutopsy({ ...base, candles: c })).toBe("stop_too_tight");
  });
  it("gave it back: 0.7 R up first, then stopped, target never came", () => {
    const c = path(
      [99.9, 100.2, 99.9, 99.5, 99.2, 98.9, 98.5, 98.2],
      [100.3, 100.8, 100.5, 100, 99.6, 99.3, 99, 98.8],
    );
    expect(lossAutopsy({ ...base, candles: c })).toBe("gave_back");
  });
  it("wrong way: never got going, never came back", () => {
    const c = path(
      [99.8, 99.6, 99.4, 99.2, 99.1, 98.9, 98.5, 98.2],
      [100.1, 100, 99.8, 99.6, 99.4, 99.2, 99, 98.8],
    );
    expect(lossAutopsy({ ...base, candles: c })).toBe("wrong_way");
  });
  it("sells are mirrored", () => {
    const c = path(
      [99.8, 100, 100.2, 100.4, 100.6, 100.8, 99.5, 98.5, 97.9],
      [100.2, 100.4, 100.6, 100.8, 100.9, 101.3, 100.5, 99.5, 98.5],
    );
    expect(lossAutopsy({ ...base, direction: "SELL", stop: 101, tp1: 98, candles: c })).toBe(
      "stop_was_entry",
    );
  });
  it("a trailed stop in profit isn't a loss, and missing data gives nothing", () => {
    const c = path([100], [101]);
    expect(lossAutopsy({ ...base, stop: 100.5, candles: c })).toBeNull();
    expect(lossAutopsy({ ...base, candles: [] })).toBeNull();
  });
  it("the target only counts inside the trade's own window", () => {
    const c = path(
      [99.8, 99.6, 99.4, 99.2, 99.1, 98.7, 99, 99.2, 99.4],
      [100.2, 100, 99.8, 99.6, 99.4, 99.2, 99.4, 99.6, 102.5],
    );
    expect(lossAutopsy({ ...base, lookMs: 2 * 60_000, candles: c })).toBe("wrong_way");
  });
});

describe("tally and lessons", () => {
  it("repairs stored junk and ranks by losses with the main reason", () => {
    const s = cleanAutopsy({
      doneTo: 5,
      tally: {
        XAUUSD: {
          engine: { ...emptyTally(), stop_was_entry: 6, wrong_way: 2 },
          "bad key!": { wrong_way: 3 },
        },
        BTCUSD: { desk: { wrong_way: 3, gave_back: "x" } },
        nope: { engine: { wrong_way: 1 } },
      },
    });
    expect(Object.keys(s.tally)).toEqual(["XAUUSD", "BTCUSD"]);
    expect(s.tally.XAUUSD["bad key!"]).toBeUndefined();
    const board = autopsyBoard(s);
    expect(board[0]).toMatchObject({
      market: "XAUUSD",
      strategy: "engine",
      losses: 8,
      main: "stop_was_entry",
      mainShare: 75,
    });
    expect(board[0].lesson).toMatch(/limit order/);
    expect(board[1]).toMatchObject({ strategy: "desk", main: "wrong_way", losses: 3 });
  });
});

describe("entryGap (lining the trade up with the chart)", () => {
  const fill = { t: 0, l: 2000, h: 2003, c: 2001 };
  it("keeps the saved gap when the entry sits inside the fill minute", () => {
    // Spot entry 2015, saved gap 13.5: on the chart 2001.5, inside 2000-2003.
    expect(entryGap(2015, 13.5, fill)).toBe(13.5);
  });
  it("nudges a gap that doesn't fit (measured on another chart) to the edge", () => {
    // Saved gap 30 puts the entry at 1985 on this chart: below the low, so 2000.
    expect(entryGap(2015, 30, fill)).toBe(15);
  });
  it("bitcoin: no gap, already inside", () => {
    expect(entryGap(2001, 0, fill)).toBe(0);
  });
  it("no fill minute: the saved gap", () => {
    expect(entryGap(2015, 7, undefined)).toBe(7);
  });
});
