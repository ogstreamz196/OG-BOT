import { describe, expect, it } from "vitest";
import { recordText, tallyRecord } from "./signal-record.server";

let n = 0;
/** One 70%+ gold signal (a fresh setup each time unless `entry` is given). */
const sig = (status: string, over: Record<string, unknown> = {}) => {
  const entry = 2400 + n++ * 10;
  return {
    market: "XAUUSD",
    label: "XAU/USD",
    direction: "BUY" as const,
    entry,
    stop: entry - 5,
    tp1: entry + 3,
    tp2: entry + 6,
    tp3: entry + 10,
    pip: 0.1,
    decimals: 2,
    status,
    best_target: 0,
    entered_at: ["unfilled", "pending"].includes(status) ? null : "2026-10-28T10:00:00Z",
    feeds: null as { bias?: boolean } | null,
    ...over,
  };
};

describe("70%+ record", () => {
  it("puts every signal in exactly one bucket, so the counts add up", () => {
    const rows = [
      sig("tp3", { best_target: 3 }), // won +100 pips
      sig("breakeven", { best_target: 1 }), // won +30 (Quick Scalp banked)
      sig("expired", { best_target: 2 }), // won +60
      sig("stopped"), // lost −50
      sig("unfilled"), // a cancelled order
      sig("pending"), // running
      sig("open"), // running
      sig("expired"), // timed out flat: not counted at all
      sig("stopped", { feeds: { bias: true } }), // bias calls never count
    ];
    const r = tallyRecord(rows, null);
    expect(r).toMatchObject({
      signals: 7,
      wins: 3,
      losses: 1,
      running: 2,
      cancelled: 1,
    });
    expect(r.wins + r.losses + r.running + r.cancelled).toBe(r.signals);
    expect(r.markets).toEqual([{ label: "XAU/USD", unit: "pips", pips: 140 }]);
    expect(recordText(r)).toBe(
      "🏆 75% WIN RATE · 7 signals\n" +
        "✅ 3 won · 🛑 1 lost\n" +
        "⏳ 2 running · 🚫 1 cancelled order\n" +
        "🟢 XAU/USD +140.0 pips",
    );
  });

  it("the same setup sent to several chats counts once, with the best outcome", () => {
    const a = sig("tp1", { best_target: 1 });
    const copy = { ...a, status: "unfilled", best_target: 0, entered_at: null };
    const r = tallyRecord([copy, a], "2026-10-01T00:00:00Z");
    expect(r).toMatchObject({ signals: 1, wins: 1, running: 0, cancelled: 0 });
    expect(recordText(r).split("\n")[0]).toBe("🏆 100% WIN RATE since 1 Oct 2026 · 1 signal");
  });

  it("reads cleanly before anything has closed", () => {
    expect(recordText(tallyRecord([], null))).toBe(
      "🏆 SIGNAL RECORD · 0 signals\n✅ 0 won · 🛑 0 lost",
    );
  });
});
