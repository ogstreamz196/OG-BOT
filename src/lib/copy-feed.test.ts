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

describe("risk multiplier cap", () => {
  it("10x is no longer accepted; 4x is the most", async () => {
    const { copySettings, MULTIPLIERS, MAX_MULTIPLIER } = await import("./copy-feed");
    expect(MAX_MULTIPLIER).toBe(4);
    expect(Math.max(...MULTIPLIERS)).toBe(4);
    expect(copySettings(JSON.stringify({ multiplier: 10 }))).toEqual({});
    expect(copySettings(JSON.stringify({ multiplier: 4 }))).toEqual({ multiplier: 4 });
  });
});

describe("manual trades in the copy feed", () => {
  it("are marked so every copier takes exactly their lot", async () => {
    const { copySignal } = await import("./copy-feed");
    const base = {
      id: "m",
      market: "XAUUSD",
      direction: "BUY" as const,
      entry: 100,
      stop: 97,
      tp1: 106,
      tp3: 106,
      status: "open",
      best_target: 0,
      entered_at: "2026-11-12T02:00:00Z",
      closed_at: null,
      created_at: "2026-11-12T02:00:00Z",
      confidence_pct: 60,
    };
    expect(copySignal({ ...base, feeds: { manual: true, paper: { lots: 0.5 } } })).toMatchObject({
      manual: true,
      lots: 0.5,
    });
    expect(copySignal({ ...base, feeds: {} }).manual).toBe(false);
  });
});

describe("the test account mirrors the copier", () => {
  it("takes the lot the copier would, in every mode", async () => {
    const { copierLot } = await import("./copy-feed");
    // Same as the bot (no settings): the bot's lot.
    expect(copierLot({}, { botLots: 0.15, confidence: 80 })).toBe(0.15);
    // The bot's lot times the multiplier (half), on MT5's 0.01 step.
    expect(copierLot({ lot: "bot", multiplier: 0.5 }, { botLots: 0.15 })).toBe(0.08);
    // A fixed lot times the multiplier.
    expect(copierLot({ lot: 0.02, multiplier: 2 }, { botLots: 0.3 })).toBe(0.04);
    // A band: bigger the surer; HFT bumps it a notch.
    expect(copierLot({ lotBand: "small" }, { botLots: 0.3, confidence: 55 })).toBe(0.01);
    expect(copierLot({ lotBand: "small" }, { botLots: 0.3, confidence: 90 })).toBe(0.05);
    expect(copierLot({ lotBand: "small", hft: true }, { botLots: 0.3, confidence: 90 })).toBe(0.1);
    // A manual trade is its own lot, whatever the mode.
    expect(
      copierLot({ lotBand: "large", hft: true, multiplier: 4 }, { botLots: 0.1, manual: true }),
    ).toBe(0.1);
    // Never under MT5's smallest lot.
    expect(copierLot({ multiplier: 0.25 }, { botLots: 0.01 })).toBe(0.01);
  });
  it("skips what the copier would skip", async () => {
    const { copierSkips, copierMaxOpen } = await import("./copy-feed");
    expect(copierSkips({}, "XAUUSD", 0)).toBeNull();
    expect(copierSkips({ paused: true }, "XAUUSD", 0)).toMatch(/paused/);
    expect(copierSkips({ markets: ["BTCUSD"] }, "XAUUSD", 0)).toMatch(/market's off/);
    expect(copierSkips({ maxOpen: 3 }, "XAUUSD", 3)).toMatch(/most open/);
    // High-frequency mode: no cap on open trades.
    expect(copierMaxOpen({ maxOpen: 8, hft: true })).toBe(Infinity);
    expect(copierSkips({ maxOpen: 3, hft: true }, "XAUUSD", 50)).toBeNull();
    expect(copierMaxOpen({})).toBe(6);
  });
  it("the copy feed sends the bot's own lot, so the copier applies its rule once", async () => {
    const { copySignal } = await import("./copy-feed");
    const row = {
      id: "x",
      market: "XAUUSD",
      direction: "BUY" as const,
      entry: 100,
      stop: 97,
      tp1: 106,
      tp3: 106,
      status: "open",
      best_target: 0,
      entered_at: null,
      closed_at: null,
      created_at: "2026-11-12T02:00:00Z",
      confidence_pct: 70,
    };
    expect(copySignal({ ...row, feeds: { paper: { lots: 0.08, botLots: 0.15 } } }).lots).toBe(0.15);
    expect(copySignal({ ...row, feeds: { paper: { lots: 0.1 } } }).lots).toBe(0.1);
  });
});
