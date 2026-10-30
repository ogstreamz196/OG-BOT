import { describe, expect, it } from "vitest";
import type { LearnSample } from "./trade-signal-backtest";
import { DEFAULT_TUNING, type Candle } from "./trade-signal";
import {
  BOUNDS,
  MIN_TRADES,
  evaluate,
  learnFromSamples,
  learnSessions,
  learnedTuning,
  liveFloor,
  losingBlocks,
  maybeLearn,
  parseLearning,
  safeTuning,
  seeded,
} from "./signal-learning.server";

const MIN = 60_000;

/** A BUY at 100 risking 10, whose price first dips `dipR` risks, then runs to 135. */
function sample(i: number, dipR: number, over: Partial<LearnSample> = {}): LearnSample {
  const t = i * 3600_000;
  const path: Candle[] = [
    { t, o: 100, h: 101, l: 100 - dipR * 10, c: 99 },
    { t: t + 5 * MIN, o: 99, h: 136, l: 99, c: 135 },
  ];
  return {
    t,
    direction: "BUY",
    entry: 100,
    entryType: "market",
    confidencePct: 70,
    verdict: "trade",
    raw: { risk: 10, targets: [110, 120, 130], atr: 10 },
    path,
    expiresAt: t + 3600_000,
    ...over,
  };
}

describe("evaluate", () => {
  it("follows each setup with the tracker's rules, in the engine's risk units", () => {
    // A 1.22R dip: the 1.2× stop is hit, a 1.3× stop survives and every target lands.
    const s = [sample(0, 1.22)];
    expect(evaluate(s, DEFAULT_TUNING)).toMatchObject({ n: 1, wins: 0, losses: 1 });
    expect(evaluate(s, DEFAULT_TUNING).sumR).toBeCloseTo(-1.2, 6);
    const wider = evaluate(s, { ...DEFAULT_TUNING, stopRoom: 1.3 });
    expect(wider).toMatchObject({ n: 1, wins: 1, losses: 0 });
    expect(wider.sumR).toBeGreaterThan(0);
  });

  it("skips waits and setups under the confidence floor", () => {
    const s = [
      sample(0, 0.1),
      sample(1, 0.1, { verdict: "wait" }),
      sample(2, 0.1, { confidencePct: 55 }),
    ];
    expect(evaluate(s, DEFAULT_TUNING).n).toBe(2);
    expect(evaluate(s, { ...DEFAULT_TUNING, minConfidence: 60 }).n).toBe(1);
  });
});

describe("learnFromSamples", () => {
  it("learns a wider stop when the market keeps shaking out the old one", () => {
    const samples = Array.from({ length: 60 }, (_, i) => sample(i, 1.22));
    const out = learnFromSamples(samples, DEFAULT_TUNING, seeded(7), "Gold");
    expect(out.kept).toBe(true);
    expect(out.next.stopRoom).toBeGreaterThan(DEFAULT_TUNING.stopRoom);
    expect(out.after.winRate).toBeGreaterThan(out.before.winRate);
    expect(out.lesson).toMatch(/^Gold: over the last 14 days, .+ so I've switched to it\.$/);
  });

  it("keeps its setting when nothing does reliably better, and too few trades teach nothing", () => {
    const clean = Array.from({ length: 60 }, (_, i) => sample(i, 0.1));
    const out = learnFromSamples(clean, DEFAULT_TUNING, seeded(3), "Bitcoin");
    expect(out.after.n).toBeGreaterThanOrEqual(MIN_TRADES);
    const few = learnFromSamples([sample(0, 1.22)], DEFAULT_TUNING, seeded(3), "Bitcoin");
    expect(few.kept).toBe(false);
    expect(few.lesson).toMatch(/too few to learn from/);
  });

  it("learns a shallower pullback when the deep one never fills", () => {
    // Price 100 stretched above its 20 EMA at 95: halfway back (97.5) never
    // trades, but it dips to 98 and then runs.
    const pulled = (i: number): LearnSample => ({
      ...sample(i, 0),
      entry: 97.5,
      entryType: "limit",
      raw: { risk: 10, targets: [107.5, 117.5, 127.5], atr: 10, pull: { price: 100, mean: 95 } },
      path: [
        { t: i * 3600_000, o: 100, h: 101, l: 98, c: 99 },
        { t: i * 3600_000 + 5 * MIN, o: 99, h: 136, l: 99, c: 135 },
      ],
    });
    const samples = Array.from({ length: 60 }, (_, i) => pulled(i));
    expect(evaluate(samples, DEFAULT_TUNING).n).toBe(0);
    const out = learnFromSamples(samples, DEFAULT_TUNING, seeded(5), "Gold");
    expect(out.kept).toBe(true);
    expect(out.next.pullback).toBeLessThanOrEqual(0.4);
    expect(out.after.n).toBe(60);
    expect(out.lesson).toMatch(/pullback entries \d+% of the way back to the 20 EMA/);
  });

  it("old saved settings without a pullback get the hand-set one", () => {
    const old = { stopRoom: 1.3, scale: [0.8, 0.6, 0.85], minConfidence: 60 } as never;
    expect(safeTuning(old).pullback).toBe(DEFAULT_TUNING.pullback);
  });

  it("never leaves the safe bounds", () => {
    const t = safeTuning({
      stopRoom: 9,
      scale: [2, -1, 0.7],
      minConfidence: 99,
      pullback: 3,
      minVol: 2,
      skipBlocks: [5, 1, 9, 1, 3],
    });
    expect(t).toEqual({
      stopRoom: BOUNDS.stopRoom[1],
      scale: [0.95, 0.4, 0.7],
      minConfidence: 80,
      pullback: 1,
      minVol: 0.8,
      skipBlocks: [1, 3],
    });
    const noisy = Array.from({ length: 80 }, (_, i) => sample(i, ((i * 37) % 17) / 10));
    const { next } = learnFromSamples(noisy, DEFAULT_TUNING, seeded(11), "Gold");
    expect(next.stopRoom).toBeGreaterThanOrEqual(BOUNDS.stopRoom[0]);
    expect(next.stopRoom).toBeLessThanOrEqual(BOUNDS.stopRoom[1]);
    expect(next.minConfidence).toBeGreaterThanOrEqual(51);
  });
});

/** A small in-memory site_content. */
function fakeAdmin() {
  const rows: Record<string, string> = {};
  return {
    rows,
    from: () => {
      let key = "";
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => ((key = v), q),
        maybeSingle: async () => ({ data: key in rows ? { value: rows[key] } : null, error: null }),
        upsert: async (row: { key: string; value: string }) => {
          rows[row.key] = row.value;
          return { error: null };
        },
      };
      return q;
    },
  };
}

/** Binance-style rows for a gently trending market. */
function fakeBinance(): typeof fetch {
  return (async (url: string) => {
    const u = new URL(url);
    const ms = { "1d": 86_400_000, "1h": 3600_000, "15m": 900_000, "5m": 300_000 }[
      u.searchParams.get("interval") as "1d"
    ];
    const start = Number(u.searchParams.get("startTime"));
    const end = Number(u.searchParams.get("endTime"));
    const rows: unknown[][] = [];
    for (let t = start; t < end && rows.length < 1000; t += ms) {
      const mid = 100 + Math.sin(t / 3.6e6) * 3 + (t / 8.64e7) * 0.5;
      rows.push([t, mid, mid + 0.6, mid - 0.6, mid + 0.1, 100]);
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
}

describe("maybeLearn", () => {
  it("studies one market, saves what it learned, and waits before the next study", async () => {
    const admin = fakeAdmin();
    const now = Date.parse("2026-10-29T12:00:00Z");
    const started = Date.now();
    const out = await maybeLearn(admin, now, fakeBinance());
    const took = Date.now() - started;
    expect(out).toMatch(
      /^Gold: (learned a better setting|kept its setting) \(\d+ setups over 14 days, 0 new, \d+ trades\)$/,
    );
    const state = parseLearning(admin.rows["signals.learning"]);
    expect(state.markets.XAUUSD).toMatchObject({ runs: 1, history: [expect.any(Object)] });
    expect(state.markets.XAUUSD.lesson).toMatch(/^Gold: /);
    expect(await maybeLearn(admin, now + 60_000, fakeBinance())).toBe("not due");
    // Next study is bitcoin, the market studied longest ago.
    expect(await maybeLearn(admin, now + 2 * 3600_000, fakeBinance())).toMatch(/^Bitcoin: /);
    // A study stays light enough for the minute watcher.
    expect(took).toBeLessThan(15_000);
  }, 60_000);
});

describe("liveFloor", () => {
  const r = (confidence_pct: number, result: "won" | "lost" | "unfilled") => ({
    confidence_pct,
    status: result === "won" ? "tp3" : result === "lost" ? "stopped" : "unfilled",
    best_target: result === "won" ? 3 : 0,
  });
  it("raises the floor past a band that's been losing live", () => {
    // Like the real last 30 days: 70–79% won 2 and lost 4, 80%+ did better.
    const rows = [
      ...[72, 74].map((c) => r(c, "won")),
      ...[71, 73, 74, 70].map((c) => r(c, "lost")),
      ...[78, 77].map((c) => r(c, "lost")),
      ...[76, 79, 75].map((c) => r(c, "won")),
      ...[85, 86, 88].map((c) => r(c, "won")),
    ];
    // 70–74: 2 won, 4 lost → floor 75; 75–79: 3 won, 2 lost (too few to judge).
    expect(liveFloor(rows)).toBe(75);
  });
  it("needs enough settled trades, and stops at the first band doing fine", () => {
    expect(liveFloor([r(55, "lost"), r(56, "lost"), r(57, "unfilled")])).toBeNull();
    const fine = [...Array(4)].map(() => r(65, "won")).concat([r(66, "lost"), r(67, "lost")]);
    const bad = [...Array(6)].map(() => r(72, "lost"));
    expect(liveFloor([...fine, ...bad])).toBeNull();
  });
});

describe("quiet charts and losing hours", () => {
  it("a too-quiet setup isn't traded once a liveliness floor is learned", () => {
    const quiet = { ...sample(0, 0.1), raw: { ...sample(0, 0.1).raw, vol: 0.3 } };
    expect(evaluate([quiet], DEFAULT_TUNING).n).toBe(1);
    expect(evaluate([quiet], { ...DEFAULT_TUNING, minVol: 0.5 }).n).toBe(0);
  });

  it("sits out a time block that keeps losing, and only when that helps", () => {
    // Block 0 (00:00–04:00 UK): stopped out every time; block 3: clean wins.
    const at = (i: number, block: number, dip: number) => ({
      ...sample(i, dip),
      raw: { ...sample(i, dip).raw, block },
    });
    const samples = [
      ...Array.from({ length: 12 }, (_, i) => at(i, 0, 1.5)),
      ...Array.from({ length: 12 }, (_, i) => at(100 + i, 3, 0.1)),
    ];
    expect(losingBlocks(samples, DEFAULT_TUNING)).toEqual([0]);
    // Too few trades in the block: left alone.
    expect(losingBlocks(samples.slice(3), DEFAULT_TUNING)).toEqual([]);
    const out = learnFromSamples(samples, DEFAULT_TUNING, seeded(2), "Gold");
    expect(out.next.skipBlocks).toEqual([0]);
    expect(out.lesson).toContain("sitting out 00:00–04:00 UK");
  });
});

describe("spread", () => {
  it("every filled trade pays it, in the engine's risk units", () => {
    const s = [sample(0, 0.1), sample(1, 0.1)];
    const free = evaluate(s, DEFAULT_TUNING);
    const paid = evaluate(
      s.map((x) => ({ ...x, cost: 0.5 })),
      DEFAULT_TUNING,
    );
    // 0.5 of price on a risk of 10 is 0.05R a trade.
    expect(free.sumR - paid.sumR).toBeCloseTo(0.1, 6);
    expect(paid.wins).toBe(free.wins);
  });
});

describe("learnSessions", () => {
  // Hourly samples from 00:00 UK (GMT in winter): each UK hour gets its own.
  const day = Date.parse("2026-11-02T00:00:00Z");
  const at = (h: number, i: number) => day + i * 86_400_000 + h * 3600_000;
  const inHour = (h: number, i: number, dipR: number) => {
    const x = sample(0, dipR);
    const t = at(h, i);
    return {
      ...x,
      t,
      path: x.path.map((c, k) => ({ ...c, t: t + k * 5 * MIN })),
      expiresAt: t + 3600_000,
    };
  };

  it("gives a session its own setting when its trades teach one, never under the live floor", () => {
    // London (08:00–11:00) keeps getting shaken out of a tight stop; the
    // Asian session is clean; New York has too few trades to judge.
    const samples = [
      ...Array.from({ length: 60 }, (_, i) => inHour(8 + (i % 3), i, 1.22)),
      ...Array.from({ length: 60 }, (_, i) => inHour(2 + (i % 3), i, 0.1)),
      ...Array.from({ length: 5 }, (_, i) => inHour(13, i, 0.1)),
    ];
    const out = learnSessions(samples, DEFAULT_TUNING, {}, seeded(7), "Gold", 30, 65);
    expect(out.london!.tuning.stopRoom).toBeGreaterThan(DEFAULT_TUNING.stopRoom);
    expect(out.asia!.n).toBeGreaterThanOrEqual(MIN_TRADES);
    expect(out.newyork).toBeUndefined();
    expect(out.evening).toBeUndefined();
    for (const x of Object.values(out)) expect(x!.tuning.minConfidence).toBeGreaterThanOrEqual(65);
  });

  it("live signals use their session's setting, else the market's", async () => {
    // Without anything learned, the hand-set rules.
    expect(await learnedTuning("NOPE", Date.now())).toEqual(DEFAULT_TUNING);
  });
});
