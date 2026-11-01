import { describe, expect, it, vi } from "vitest";
import { advanceSignal, trailsThis, TRAIL } from "./trade-signal-outcome";
import { tallyRecord } from "./signal-record.server";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// An open take profit with a trailing stop: a buy at 100, stop 98 (risk 2),
// capped at 3 risks (106). Once 1 risk up the stop goes to the entry, then
// trails a risk behind the best price.
const MIN = 60_000;
const bar = (i: number, l: number, h: number) => ({
  t: i * MIN,
  o: (l + h) / 2,
  h,
  l,
  c: (l + h) / 2,
});
const buy = {
  direction: "BUY" as const,
  entry: 100,
  stop: 98,
  targets: [106, 106, 106] as [number, number, number],
  status: "open" as const,
  expiresAt: 60 * MIN,
  trail: { risk: 2 },
};

describe("trailing stop", () => {
  it("only the surest trades going with the bigger timeframe trail", () => {
    expect(trailsThis(82, "BUY", "bullish")).toBe(true);
    expect(trailsThis(82, "BUY", "bearish")).toBe(false);
    expect(trailsThis(75, "SELL", "bearish")).toBe(false);
    expect(TRAIL).toEqual({ CAP: 3, GAP: 1 });
  });

  it("nothing moves until it's a full risk up", () => {
    const r = advanceSignal(buy, [bar(0, 99.5, 101.5)], MIN);
    expect(r.events).toEqual([]);
    expect(r.status).toBe("open");
  });

  it("a risk up: stop to the entry; further up it trails a risk behind, never back", () => {
    const r = advanceSignal(
      buy,
      [bar(0, 99.5, 102), bar(1, 101.5, 103.5), bar(2, 102.8, 103)],
      MIN * 3,
    );
    expect(r.events.map((e) => [e.kind, e.price])).toEqual([
      ["trailed", 100],
      ["trailed", 101.5],
    ]);
    expect(r.status).toBe("open");
  });

  it("the trailing stop closes it in profit", () => {
    const r = advanceSignal({ ...buy, trail: { risk: 2, stop: 101.5 } }, [bar(0, 101, 102)], MIN);
    expect(r.status).toBe("breakeven");
    expect(r.events).toEqual([{ kind: "breakeven", at: 0, price: 101.5 }]);
  });

  it("the cap still takes profit, and before it starts the old stop still counts", () => {
    expect(advanceSignal(buy, [bar(0, 99.5, 106.2)], MIN).status).toBe("tp3");
    expect(advanceSignal(buy, [bar(0, 97.5, 100.5)], MIN).status).toBe("stopped");
  });

  it("counts a trailing exit in profit as a win, at the entry as neither", () => {
    const row = (stop: number) => ({
      market: "XAUUSD",
      label: "Gold",
      direction: "BUY" as const,
      entry: 100 + stop,
      stop: 98 + stop,
      tp1: 106 + stop,
      tp2: 106 + stop,
      tp3: 106 + stop,
      pip: 0.1,
      decimals: 2,
      status: "breakeven",
      best_target: 0,
      entered_at: "2026-11-01T10:00:00Z",
      feeds: { trail: { risk: 2, stop: 101.5 + stop } },
    });
    const won = tallyRecord([row(0)], null);
    expect(won.wins).toBe(1);
    expect(won.markets[0].pips).toBe(15);
    const flat = tallyRecord([{ ...row(10), feeds: { trail: { risk: 2, stop: 110 } } }], null);
    expect(flat.wins + flat.losses).toBe(0);
  });

  it("announces it plainly", async () => {
    const { chatLine } = await import("./trade-signal-tracker.server");
    const row = {
      direction: "BUY",
      entry: 100,
      tp1: 106,
      tp3: 106,
      decimals: 2,
      pip: null,
      feeds: { trail: { risk: 2, stop: 101.5 } },
    } as never;
    expect(chatLine(row, { kind: "trailed", at: 0, price: 101.5 })).toBe(
      "🏃 Trailing my stop · now 101.50",
    );
    expect(chatLine(row, { kind: "breakeven", at: 0, price: 101.5 })).toBe(
      "🏃 Trailing stop hit at 101.50",
    );
  });
});
