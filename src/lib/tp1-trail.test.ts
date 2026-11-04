import { describe, expect, it, vi } from "vitest";
import { advanceSignal, TP_TRAIL, tpTrailArm } from "./trade-signal-outcome";
import { tallyRecord } from "./signal-record.server";
import { paperPnl } from "./paper-account.server";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// Balance first: about to hit the take profit, the trade trails instead of
// closing there. A buy at 100 with its take profit at 110 (distance 10).
const MIN = 60_000;
const bar = (i: number, l: number, h: number) => ({
  t: i * MIN,
  o: (l + h) / 2,
  h,
  l,
  c: (l + h) / 2,
});
const arm = (best: number, spread = 0.5) =>
  tpTrailArm({ direction: "BUY", entry: 100, tp: 110, best, spread });

describe("trailing as the take profit is about to hit", () => {
  it("arms at 90% of the way: the stop 20% behind the best price, a cap at 3x", () => {
    expect(TP_TRAIL).toEqual({ ARM: 0.9, GAP: 0.2, SPREADS: 2, CAP: 3 });
    // The trail starts at 30% of the gain (the Boss, 2026-11-04): 30% of the 9
    // from 100 to 109 best = 102.7, and reports the gain-keep for the follow.
    expect(arm(109)).toEqual({ stop: 102.7, gap: 2, gainKeep: 0.3, cap: 130 });
    expect(arm(108.9)).toBeNull(); // not near yet
    expect(arm(110)).toBeNull(); // already hit: it closed there
  });

  it("keeps the gap at 2 spreads at least, and never under 30% of the gain", () => {
    // A 1.5 spread: gap 3 instead of 2.
    expect(arm(109, 1.5)).toEqual({ stop: 102.7, gap: 3, gainKeep: 0.3, cap: 130 });
    // A huge spread can't drag the stop under the gain lock: 30% of the 9 gain
    // from 100 to the 109 best = 102.7 (the Boss's rule, 2026-11-04).
    expect(arm(109, 5)?.stop).toBe(102.7);
  });

  it("works the other way round for a sell", () => {
    expect(tpTrailArm({ direction: "SELL", entry: 100, tp: 90, best: 91, spread: 0.5 })).toEqual({
      stop: 97.3, // 30% of the 9 gain down from 100 to the 91 best
      gap: 2,
      gainKeep: 0.3,
      cap: 70,
    });
  });

  it("once armed it isn't closed at the old take profit: it follows the price and exits on the trail", () => {
    const armed = {
      direction: "BUY" as const,
      entry: 100,
      stop: 95,
      targets: [130, 130, 130] as [number, number, number],
      status: "open" as const,
      expiresAt: 60 * MIN,
      trail: { risk: 2, stop: 102.7, gainKeep: 0.3 },
    };
    // Through the old take profit (110) to a 114 best: the stop locks 30% of
    // the 14 gain = 104.2, moving up only; then it falls back to it.
    const r = advanceSignal(armed, [bar(0, 108, 114), bar(1, 103, 113)], 2 * MIN);
    expect(r.events.map((e) => [e.kind, e.price])).toEqual([
      ["trailed", 104.2],
      ["breakeven", 104.2],
    ]);
  });

  it("a profit-lock or trailing exit counts as a win (money made)", () => {
    const row = {
      market: "BTCUSD",
      label: "BTC/USD",
      direction: "BUY" as const,
      entry: 100,
      stop: 95,
      tp1: 110,
      tp2: 110,
      tp3: 110,
      pip: null,
      decimals: 2,
      status: "breakeven",
      best_target: 0,
      entered_at: "2026-11-03T10:00:00Z",
      feeds: { lock: true },
    };
    const locked = tallyRecord([row], null);
    expect(locked.wins).toBe(1);
    expect(locked.markets[0].pips).toBe(3); // the lock at 30% of the way
    const trailed = tallyRecord(
      [
        {
          ...row,
          entry: 200,
          stop: 195,
          tp1: 230,
          tp2: 230,
          tp3: 230,
          feeds: { lock: true, tp0: 210, trail: { risk: 2, stop: 207 } },
        },
      ],
      null,
    );
    expect(trailed.markets[0].pips).toBe(7);
  });

  it("the demo pays half a spread more on a trailing exit (closed at market on the bid)", () => {
    const t = {
      market: "BTCUSD",
      direction: "BUY" as const,
      entry: 70000,
      stop: 69900,
      tp1: 70300,
      tp2: 70300,
      tp3: 70300,
      marketEntry: false,
      entered: true,
      status: "breakeven",
      bestTarget: 0,
      lastPrice: null,
      lockStop: 70210,
    };
    // 0.1 lot of bitcoin: $0.10 a dollar. Lock exit: +$21; trailing exit: half of a $15 spread less.
    expect(paperPnl(t, 0.1, 15)).toBe(21);
    expect(paperPnl({ ...t, trailExit: true }, 0.1, 15)).toBe(20.25);
  });
});
