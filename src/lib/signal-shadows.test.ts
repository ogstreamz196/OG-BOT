import { beforeEach, describe, expect, it, vi } from "vitest";

// Shadow trades: the setups the bot didn't send, followed silently with the
// tracker's rules so the Boss's report can show what each filter is worth.

const MIN = 60_000;
const NOW = Date.parse("2026-10-30T12:00:00Z");
let candles: { t: number; o: number; h: number; l: number; c: number }[] = [];

vi.mock("./trade-signal-context.server", () => ({
  candles: async () => ({ data: candles }),
}));

import { followShadows, recordShadow, shadowResult, waitReasonKind } from "./signal-shadows.server";

type Row = Record<string, any>;
/** A small in-memory signal_shadows. */
function fakeAdmin() {
  const rows: Row[] = [];
  return {
    rows,
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let del = false;
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        lt: (c: string, v: string) => (filters.push((r) => r[c] < v), q),
        update: (p: Row) => ((patch = p), q),
        delete: () => ((del = true), q),
        upsert: async (row: Row) => {
          if (!rows.some((r) => r.key === row.key)) rows.push(row);
          return { error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (patch) hit.forEach((r) => Object.assign(r, patch));
          if (del) for (const r of hit) rows.splice(rows.indexOf(r), 1);
          resolve({ data: hit, error: null });
        },
      };
      return q;
    },
  };
}

const summary = (over: Record<string, unknown> = {}) => ({
  market: "BTCUSD",
  label: "BTC/USD",
  timeframe: "5M",
  direction: "BUY" as const,
  confidencePct: 64,
  entry: 100,
  entryType: "market" as const,
  stop: 95,
  targets: [104],
  offset: 0,
  validUntil: new Date(NOW + 60 * MIN).toISOString(),
  decimals: 2,
  pip: null,
  ...over,
});

const bar = (t: number, l: number, h: number) => ({ t, o: 100, h, l, c: (l + h) / 2 });

beforeEach(() => {
  candles = [];
});

describe("waitReasonKind", () => {
  it("names the filter that made the engine wait, and skips the ones worth nothing", () => {
    expect(
      waitReasonKind("Not strong enough: past results say setups under 62% aren't worth it."),
    ).toBe("floor");
    expect(
      waitReasonKind("Too quiet: price is barely moving, so targets rarely get reached."),
    ).toBe("quiet");
    expect(waitReasonKind("This time of day has been losing lately, so I'm sitting it out.")).toBe(
      "losing_hours",
    );
    expect(waitReasonKind("No real trend right now, price is ranging.")).toBe("choppy");
    expect(
      waitReasonKind("The timeframes disagree and short-term momentum is against the trade."),
    ).toBe("mixed");
    expect(waitReasonKind("Not enough room: the next resistance is only 0.6R away.")).toBe(
      "no_room",
    );
    expect(waitReasonKind("Gold's market is closed for the weekend.")).toBeNull();
    expect(waitReasonKind(undefined)).toBeNull();
  });
});

describe("shadowResult", () => {
  const row = { direction: "SELL" as const, entry: 2650, stop: 2655, tp: 2647, pip: 0.1 };
  it("a take profit is a win and a stop a loss, in pips", () => {
    expect(shadowResult(row, "tp3", true, NaN)).toEqual({ outcome: "win", pips: 30 });
    expect(shadowResult(row, "stopped", true, NaN)).toEqual({ outcome: "loss", pips: -50 });
  });
  it("timed out: flat at the last price if it filled, else unfilled", () => {
    expect(shadowResult(row, "expired", true, 2649)).toEqual({ outcome: "flat", pips: 10 });
    expect(shadowResult(row, "unfilled", false, 2649)).toEqual({ outcome: "unfilled", pips: 0 });
  });
});

describe("recordShadow and followShadows", () => {
  it("keeps one shadow per market per 5 minutes, the desk's apart", async () => {
    const admin = fakeAdmin();
    await recordShadow(admin, summary(), "below_alert", NOW);
    await recordShadow(admin, summary({ entry: 101 }), "floor", NOW + 10_000);
    await recordShadow(admin, summary(), "desk_no", NOW + 20_000);
    await recordShadow(admin, summary(), "below_alert", NOW + 5 * MIN);
    expect(admin.rows.map((r) => r.reason)).toEqual(["below_alert", "desk_no", "below_alert"]);
    // Nothing that's already run out of time, and nothing without levels.
    await recordShadow(
      admin,
      summary({ validUntil: new Date(NOW - 1).toISOString() }),
      "floor",
      NOW + 10 * MIN,
    );
    await recordShadow(admin, undefined, "floor", NOW + 15 * MIN);
    expect(admin.rows).toHaveLength(3);
  });

  it("follows each shadow silently until it wins, loses or runs out of time", async () => {
    const admin = fakeAdmin();
    const t0 = NOW + 60 * MIN;
    await recordShadow(
      admin,
      summary({ validUntil: new Date(t0 + 60 * MIN).toISOString() }),
      "below_alert",
      t0,
    );
    await recordShadow(
      admin,
      summary({
        direction: "SELL",
        entry: 100,
        stop: 105,
        targets: [96],
        validUntil: new Date(t0 + 60 * MIN).toISOString(),
      }),
      "desk_no",
      t0 + 1000,
    );
    // Price runs up through the buy's take profit and the sell's stop.
    candles = [bar(t0 + MIN, 99, 102), bar(t0 + 2 * MIN, 101, 106)];
    expect(await followShadows(admin, t0 + 3 * MIN + 5_000)).toBe("2 running, 2 finished");
    const [buy, sell] = admin.rows;
    expect(buy).toMatchObject({ status: "tp3", outcome: "win", pips: 4 });
    expect(sell).toMatchObject({ status: "stopped", outcome: "loss", pips: -5 });
    expect(await followShadows(admin, t0 + 4 * MIN)).toBe("none running");
  });
});
