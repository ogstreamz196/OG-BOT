import { describe, expect, it } from "vitest";
import {
  copyFeed,
  copySettings,
  copySignal,
  effectiveBand,
  testSignal,
  type CopyFeedRow,
} from "./copy-feed";

const row = (over: Partial<CopyFeedRow> = {}): CopyFeedRow => ({
  id: "a",
  market: "BTCUSD",
  direction: "BUY",
  entry: 100,
  stop: 95,
  tp1: 110,
  tp3: 110,
  status: "open",
  best_target: 0,
  entered_at: "2026-11-10T10:00:00Z",
  closed_at: null,
  created_at: "2026-11-10T09:59:00Z",
  confidence_pct: 70,
  feeds: { lock: true },
  ...over,
});

describe("copy feed", () => {
  it("an open trade: the original stop, not half closed", () => {
    expect(copySignal(row())).toMatchObject({
      active: true,
      filled: true,
      stopNow: 95,
      halfClosed: false,
    });
  });
  it("a pending entry isn't filled yet", () => {
    expect(copySignal(row({ status: "pending", entered_at: null }))).toMatchObject({
      active: true,
      filled: false,
    });
  });
  it("high-frequency mode bumps the lot band up one notch", () => {
    expect(effectiveBand("small", false)).toBe("small");
    expect(effectiveBand("small", true)).toBe("medium");
    expect(effectiveBand("medium", true)).toBe("large");
    expect(effectiveBand("large", true)).toBe("large");
  });
  it("passes the hedge flag and the entry type through", () => {
    expect(copySignal(row())).toMatchObject({ hedge: false, entryType: "market" });
    expect(copySignal(row({ feeds: { hedge: true, lock: true } })).hedge).toBe(true);
    expect(copySignal(row({ feeds: { entry: "stop" } })).entryType).toBe("stop");
    expect(copySignal(row({ status: "pending", entered_at: null })).entryType).toBe("limit");
  });
  it("the profit lock moves the stop to 30% of the way", () => {
    expect(copySignal(row({ feeds: { lock: true, protected: true } })).stopNow).toBe(103);
  });
  it("a trailing runner: the trail's stop, half closed once TP1 banked", () => {
    const s = copySignal(
      row({
        tp3: 130,
        status: "tp1",
        best_target: 1,
        feeds: { lock: true, tp0: 110, trail: { stop: 106 } },
      }),
    );
    expect(s).toMatchObject({ active: true, stopNow: 106, halfClosed: true, tp1: 110, tp3: 130 });
  });
  it("carries the bot's lot for the trade, else null", () => {
    expect(copySignal(row({ feeds: { lock: true, paper: { lots: 0.15 } } })).lots).toBe(0.15);
    expect(copySignal(row()).lots).toBeNull();
  });
  it("over: not active", () => {
    expect(copySignal(row({ status: "breakeven", closed_at: "2026-11-10T10:30:00Z" })).active).toBe(
      false,
    );
  });
  it("leaves market-bias calls out, newest first", () => {
    const f = copyFeed([
      row({ id: "old", created_at: "2026-11-10T08:00:00Z" }),
      row({ id: "bias", feeds: { bias: true } }),
      row({ id: "new", created_at: "2026-11-10T11:00:00Z" }),
    ]);
    expect(f.map((s) => s.id)).toEqual(["new", "old"]);
  });
});

describe("copier test signal", () => {
  const now = Date.parse("2026-11-11T20:00:00Z");
  const v = (o: object) =>
    JSON.stringify({
      id: "1",
      market: "BTCUSD",
      direction: "BUY",
      createdAt: "2026-11-11T20:00:00Z",
      until: now + 60_000,
      ...o,
    });
  it("an open test trade: filled, active, its stop out of reach", () => {
    expect(testSignal(v({}), now)).toMatchObject({
      id: "test-1",
      active: true,
      filled: true,
      stopNow: 0,
      halfClosed: false,
    });
    expect(testSignal(v({ direction: "SELL" }), now)!.stopNow).toBeGreaterThan(1e9);
  });
  it("half closed, then over", () => {
    expect(testSignal(v({ status: "tp1", halfClosed: true }), now)).toMatchObject({
      active: true,
      halfClosed: true,
    });
    expect(testSignal(v({ status: "tp3" }), now)!.active).toBe(false);
  });
  it("nothing when unset, broken or past its time", () => {
    expect(testSignal(null, now)).toBeNull();
    expect(testSignal("{oops", now)).toBeNull();
    expect(testSignal(v({ until: now - 1 }), now)).toBeNull();
  });
});

describe("copiers' remote settings", () => {
  it("passes only valid keys, clamped", () => {
    expect(
      copySettings(
        JSON.stringify({
          paused: true,
          lot: "bot",
          markets: ["xauusd", "BTCUSD", "BTCUSD", "bad market!"],
          maxOpen: 99,
          maxLateMinutes: 0,
          useBrokerStop: false,
          junk: 1,
        }),
      ),
    ).toEqual({
      paused: true,
      lot: "bot",
      markets: ["XAUUSD", "BTCUSD"],
      maxOpen: 50,
      maxLateMinutes: 1,
      useBrokerStop: false,
    });
    expect(copySettings(JSON.stringify({ lot: 0.054 }))).toEqual({ lot: 0.05 });
    expect(copySettings(JSON.stringify({ lot: 9, paused: "yes" }))).toEqual({});
  });
  it("nothing set or broken: empty, so each copier keeps its config.ini", () => {
    expect(copySettings(null)).toEqual({});
    expect(copySettings("{oops")).toEqual({});
  });
});
