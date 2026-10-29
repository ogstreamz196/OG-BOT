import { describe, expect, it } from "vitest";
import type { LearnSample } from "./trade-signal-backtest";
import { DEFAULT_TUNING, type Candle } from "./trade-signal";
import {
  BOUNDS,
  MIN_TRADES,
  evaluate,
  learnFromSamples,
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
    expect(out.lesson).toMatch(/^Gold: over the last 7 days, .+ so I've switched to it\.$/);
  });

  it("keeps its setting when nothing does reliably better, and too few trades teach nothing", () => {
    const clean = Array.from({ length: 60 }, (_, i) => sample(i, 0.1));
    const out = learnFromSamples(clean, DEFAULT_TUNING, seeded(3), "Bitcoin");
    expect(out.after.n).toBeGreaterThanOrEqual(MIN_TRADES);
    const few = learnFromSamples([sample(0, 1.22)], DEFAULT_TUNING, seeded(3), "Bitcoin");
    expect(few.kept).toBe(false);
    expect(few.lesson).toMatch(/too few to learn from/);
  });

  it("never leaves the safe bounds", () => {
    const t = safeTuning({ stopRoom: 9, scale: [2, -1, 0.7], minConfidence: 99 });
    expect(t).toEqual({ stopRoom: BOUNDS.stopRoom[1], scale: [0.95, 0.4, 0.7], minConfidence: 80 });
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
      /^Gold: (learned a better setting|kept its setting) \(\d+ setups, \d+ trades\)$/,
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
