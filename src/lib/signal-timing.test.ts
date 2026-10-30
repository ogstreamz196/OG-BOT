import { describe, expect, it } from "vitest";
import { advanceTimed, limitsFrom } from "./trade-signal-outcome";
import { blackout } from "./trade-signal-extras";
import { cachedChartFresh } from "./trade-signal-context.server";
import { DEFAULT_TUNING } from "./trade-signal";
import { evaluate, timeLimits } from "./signal-learning.server";
import type { LearnSample } from "./trade-signal-backtest";

// Timing: learned time limits on trades, blackouts, and charts read right at the close.

const MIN = 60_000;
const T0 = Date.parse("2026-11-04T14:00:00Z"); // a Wednesday, 9am New York
const bar = (i: number, l: number, h: number) => ({
  t: T0 + i * MIN,
  o: 100,
  h,
  l,
  c: (l + h) / 2,
});
const buy = {
  direction: "BUY" as const,
  entry: 100,
  stop: 95,
  targets: [104, 104, 104] as [number, number, number],
  expiresAt: T0 + 60 * MIN,
};

describe("advanceTimed", () => {
  it("closes a trade that's gone nowhere once its hold is up", () => {
    const flat = Array.from({ length: 40 }, (_, i) => bar(i, 99, 101));
    const open = { ...buy, status: "open" as const, enteredAt: T0 };
    expect(advanceTimed(open, flat, T0 + 40 * MIN).status).toBe("open");
    const r = advanceTimed(open, flat, T0 + 40 * MIN, { holdMs: 30 * MIN });
    expect(r.status).toBe("expired");
    // A take profit inside the hold still counts.
    const runs = [...flat.slice(0, 20), bar(20, 100, 105)];
    expect(advanceTimed(open, runs, T0 + 21 * MIN, { holdMs: 30 * MIN }).status).toBe("tp3");
  });

  it("cancels an entry that doesn't fill in time, and holds from the fill when it does", () => {
    const pending = { ...buy, entryType: "limit" as const, status: "pending" as const };
    const above = Array.from({ length: 20 }, (_, i) => bar(i, 100.5, 102));
    expect(advanceTimed(pending, above, T0 + 20 * MIN, { fillBy: T0 + 15 * MIN }).status).toBe(
      "unfilled",
    );
    // Fills at minute 10, then drifts: the 15-minute hold runs from the fill, not the signal.
    const fills = [
      ...above.slice(0, 10),
      bar(10, 99.5, 101),
      ...Array.from({ length: 14 }, (_, i) => bar(11 + i, 99, 101)),
    ];
    const r = advanceTimed(pending, fills, T0 + 24 * MIN + 30_000, {
      fillBy: T0 + 15 * MIN,
      holdMs: 15 * MIN,
    });
    expect(r.events.map((e) => e.kind)).toEqual(["filled"]);
    expect(r.status).toBe("open");
    expect(
      advanceTimed(pending, fills, T0 + 26 * MIN, { fillBy: T0 + 15 * MIN, holdMs: 15 * MIN })
        .status,
    ).toBe("expired");
  });

  it("reads the limits stored with a signal", () => {
    expect(limitsFrom({ fillWithin: 15, holdFor: 30 }, T0)).toEqual({
      fillBy: T0 + 15 * MIN,
      holdMs: 30 * MIN,
    });
    expect(limitsFrom(null, T0)).toEqual({});
  });
});

describe("learning a time stop", () => {
  it("a trade cut at its hold is scored at the price then, not the end of the hour", () => {
    // Drifts up to +2 for 30 minutes, then sinks to −4 by the end of the hour.
    const path = [
      ...Array.from({ length: 6 }, (_, i) => ({
        t: T0 + i * 5 * MIN,
        o: 101,
        h: 102.5,
        l: 100.5,
        c: 102,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        t: T0 + (30 + i * 5) * MIN,
        o: 99,
        h: 99.5,
        l: 96,
        c: 96,
      })),
    ];
    const s: LearnSample = {
      t: T0,
      direction: "BUY",
      entry: 100,
      entryType: "market",
      confidencePct: 70,
      verdict: "trade",
      raw: { risk: 5 / 1.2, targets: [110, 120, 130], atr: 5 },
      path,
      expiresAt: T0 + 60 * MIN,
    };
    const whole = evaluate([s], DEFAULT_TUNING);
    const cut = evaluate([s], { ...DEFAULT_TUNING, holdFor: 30 });
    expect(cut.sumR).toBeGreaterThan(whole.sumR);
    expect(cut.sumR).toBeGreaterThan(0);
    expect(timeLimits(DEFAULT_TUNING, T0)).toEqual({});
  });
});

describe("blackout", () => {
  const ny = (iso: string) => Date.parse(iso);
  it("sits out the daily rollover, big US news and gold's Friday close", () => {
    // 17:00 New York (10pm UK): rollover.
    expect(blackout(ny("2026-11-04T22:00:00Z"), { gold: false, news: [] })).toMatch(/^Rollover/);
    expect(blackout(ny("2026-11-04T23:10:00Z"), { gold: false, news: [] })).toBeNull();
    // Friday 16:30 New York: gold only.
    const fri = ny("2026-11-06T21:30:00Z");
    expect(blackout(fri, { gold: true, news: [] })).toMatch(/weekend/);
    expect(blackout(fri, { gold: false, news: [] })).toBeNull();
    const nfp = {
      title: "Non-Farm Payrolls",
      currency: "USD",
      impact: "High",
      at: ny("2026-11-06T13:30:00Z"),
    };
    expect(blackout(nfp.at - 3 * MIN, { gold: true, news: [nfp] })).toMatch(/Non-Farm Payrolls/);
    expect(blackout(nfp.at + 9 * MIN, { gold: true, news: [nfp] })).toMatch(/Big US news/);
    expect(blackout(nfp.at + 11 * MIN, { gold: true, news: [nfp] })).toBeNull();
    expect(blackout(T0, { gold: true, news: [{ ...nfp, impact: "Medium", at: T0 }] })).toBeNull();
  });
});

describe("cachedChartFresh", () => {
  it("a chart fetched before a candle closed is stale right after the close", () => {
    const close = Date.parse("2026-11-04T14:05:00Z");
    const hit = { exp: close + 10_000, at: close - 3_000 };
    expect(cachedChartFresh(hit, "5m", close - 1_000)).toBe(true);
    expect(cachedChartFresh(hit, "5m", close + 1_000)).toBe(false);
    expect(cachedChartFresh({ ...hit, at: close + 500 }, "5m", close + 1_000)).toBe(true);
  });
});
