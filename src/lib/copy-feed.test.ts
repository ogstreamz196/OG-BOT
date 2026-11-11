import { describe, expect, it } from "vitest";
import { copyFeed, copySignal, type CopyFeedRow } from "./copy-feed";

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
