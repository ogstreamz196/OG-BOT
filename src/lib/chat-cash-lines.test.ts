import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// The signals chat's update lines: short and prices only (the Boss's split:
// the OG Trade Bot makes signals, the Copy Trader B0T does the money).
const row = {
  id: "1",
  user_id: "u",
  sender_worker: "trade",
  chat_id: 1,
  message_id: 1,
  market: "BTCUSD",
  label: "BTC/USD",
  feeds: { lock: true },
  timeframe: "15M",
  direction: "SELL" as const,
  entry: 77397.7,
  stop: 77496.66,
  tp1: 77331.73,
  tp2: 77331.73,
  tp3: 77331.73,
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
} as never;

describe("signals chat lines, prices only", () => {
  it("the live price line", async () => {
    const { chatLiveLine } = await import("./trade-signal-tracker.server");
    const at = Date.parse("2026-10-31T14:09:00Z");
    expect(chatLiveLine(row, 77372.4, at, 0.1)).toBe("📍 77372.40 · 14:09");
  });
  it("short updates, with no money in them", async () => {
    const { chatLine } = await import("./trade-signal-tracker.server");
    expect(chatLine(row, { kind: "filled", at: 0, price: 77397.7 }, 0.1)).toBe("✅ In at 77397.70");
    expect(chatLine(row, { kind: "stopped", at: 0, price: 0 }, 0.1)).toBe(
      "🛑 Stopped out at 77496.66",
    );
    expect(chatLine(row, { kind: "tp1", at: 0, price: 0 }, 0.1, 6.48)).toBe(
      "🎯 Take profit hit at 77331.73",
    );
    expect(chatLine(row, { kind: "protected", at: 0, price: 0 }, 0.1)).toMatch(
      /^🔒 70% there · stop moved to 77377\.91$/,
    );
    expect(chatLine(row, { kind: "cancelled", bias: "bullish" }, 0.1)).toBe(
      "⚠️ 4H trend turned bullish · closed",
    );
  });
});
