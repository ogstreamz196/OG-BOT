import { describe, expect, it, vi } from "vitest";
import { tpMove } from "./trade-signal-outcome";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// Moving the take profit while a trade runs, always announced. A buy at 100
// with its take profit at 110 (distance 10).
const MIN = 60_000;
const c = (i: number, o: number, cl: number, h = Math.max(o, cl), l = Math.min(o, cl)) => ({
  t: i * MIN,
  o,
  c: cl,
  h,
  l,
});
const buy = { direction: "BUY" as const, entry: 100, tp: 110, tp0: 110, moves: [] };

describe("take profit moves", () => {
  it("further out while it's still pushing hard right by the take profit", () => {
    const candles = [c(0, 100, 103), c(1, 103, 106), c(2, 106, 108), c(3, 108, 109)];
    expect(tpMove({ ...buy, candles })).toEqual({ tp: 115, kind: "extend", best: 109 });
  });
  it("not when it's pushing but still far off, or a candle went against it", () => {
    expect(
      tpMove({ ...buy, candles: [c(0, 100, 101), c(1, 101, 102), c(2, 102, 103)] }),
    ).toBeNull();
    expect(
      tpMove({ ...buy, candles: [c(0, 106, 108), c(1, 108, 107.5), c(2, 107.5, 109)] }),
    ).toBeNull();
  });
  it("never past twice the original distance", () => {
    const candles = [c(0, 112, 114), c(1, 114, 116), c(2, 116, 118)];
    expect(tpMove({ ...buy, tp: 118.5, candles })).toMatchObject({ tp: 120, kind: "extend" });
    expect(
      tpMove({ ...buy, tp: 120, candles: [c(0, 115, 117), c(1, 117, 118), c(2, 118, 119)] }),
    ).toBeNull();
  });
  it("in when it came close, stalled ten minutes and pulled back", () => {
    const candles = [
      c(0, 100, 104),
      c(1, 104, 108, 109.2),
      ...Array.from({ length: 10 }, (_, i) => c(2 + i, 107, 107.2, 107.8, 106.8)),
      c(12, 107.2, 107.4, 107.6, 107),
    ];
    // Best 109.2 (92% of the way), back to 107.4: in to 108.2.
    const mv = tpMove({ ...buy, candles });
    expect(mv?.kind).toBe("pull");
    expect(mv?.tp).toBeCloseTo(108.2);
    expect(mv?.best).toBe(109.2);
    // Only ever once.
    expect(tpMove({ ...buy, candles, moves: [{ kind: "pull" }] })).toBeNull();
  });
  it("not before ten minutes of stalling", () => {
    const candles = [c(0, 100, 104), c(1, 104, 108, 109.2), c(2, 108, 107.4, 108, 107)];
    expect(tpMove({ ...buy, candles })).toBeNull();
  });
  it("at most two moves a trade, and the same the other way for a sell", () => {
    const up = [c(0, 100, 103), c(1, 103, 106), c(2, 106, 108), c(3, 108, 109)];
    expect(
      tpMove({ ...buy, candles: up, moves: [{ kind: "extend" }, { kind: "extend" }] }),
    ).toBeNull();
    const down = [c(0, 100, 97), c(1, 97, 94), c(2, 94, 92), c(3, 92, 91)];
    expect(
      tpMove({ direction: "SELL", entry: 100, tp: 90, tp0: 90, moves: [], candles: down }),
    ).toEqual({ tp: 85, kind: "extend", best: 91 });
  });
  it("announces each move in plain words", async () => {
    const { tpMoveLine } = await import("./trade-signal-tracker.server");
    const row = { direction: "BUY", entry: 100, tp1: 110, decimals: 2, pip: null } as never;
    expect(tpMoveLine(row, { tp: 115, kind: "extend", best: 109 }, 110)).toBe(
      "🚀 It's still flying, so I'm moving my take profit up to 115.00 (was 110.00) and letting it run",
    );
    expect(tpMoveLine(row, { tp: 108.2, kind: "pull", best: 109.2 }, 110)).toBe(
      "✋ It stalled at 109.20 and pulled back, so I'm bringing my take profit in to 108.20 (was 110.00) to bank it on the next push",
    );
  });
  it("the profit lock stays on the original take profit after a move", async () => {
    const { lockOf } = await import("./trade-signal-tracker.server");
    const row = {
      direction: "BUY" as const,
      entry: 100,
      tp1: 115,
      feeds: { lock: true, tp0: 110 },
    };
    expect(lockOf(row)).toEqual({ trigger: 107, stop: 103 });
  });
});
