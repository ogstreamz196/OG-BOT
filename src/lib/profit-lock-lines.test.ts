import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// What members are told when the profit lock fires and when it closes a trade.
describe("profit lock messages", () => {
  const row = {
    id: "1",
    user_id: "u",
    sender_worker: "trade",
    chat_id: 1,
    message_id: 1,
    market: "XAUUSD",
    label: "Gold",
    feeds: { lock: true },
    timeframe: "5M",
    direction: "BUY" as const,
    entry: 2650,
    stop: 2645,
    tp1: 2660,
    tp2: 2660,
    tp3: 2660,
    decimals: 2,
    pip: null,
    card: null,
    status: "open" as const,
    best_target: 0,
    entered_at: null,
    last_price: null,
    last_candle_at: null,
    last_edit_at: null,
    last_trend_check_at: null,
    expires_at: "2026-10-31T13:00:00Z",
    created_at: "2026-10-31T12:00:00Z",
  };
  it("says where the stop moved and what's locked in", async () => {
    const { eventLine, lockOf } = await import("./trade-signal-tracker.server");
    expect(lockOf(row)).toEqual({ trigger: 2657, stop: 2653 });
    const fired = eventLine(row as never, { kind: "protected", at: 0, price: 2657 });
    expect(fired).toContain("70% of the way");
    expect(fired).toContain("2653.00");
    const out = eventLine(row as never, { kind: "breakeven", at: 0, price: 2653 });
    expect(out).toContain("locked stop at 2653.00");
    expect(out).not.toContain("breakeven");
  });
  it("older signals without the lock keep the old breakeven wording", async () => {
    const { eventLine, lockOf } = await import("./trade-signal-tracker.server");
    const old = { ...row, feeds: {} };
    expect(lockOf(old)).toBeNull();
    expect(eventLine(old as never, { kind: "breakeven", at: 0, price: 2650 })).toContain(
      "breakeven",
    );
  });
});
