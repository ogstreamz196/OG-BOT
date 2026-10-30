import { describe, expect, it } from "vitest";
import {
  BACKFILL_DAYS,
  LEARN_DAYS,
  REPLAY_DAYS,
  gatherSamples,
  rangesToReplay,
} from "./signal-samples.server";

// The learning loop's history grows study by study: what's new since the
// last one, plus a week further back, until it covers 90 days.

const DAY = 86_400_000;

type Row = Record<string, any>;
/** A small in-memory signal_learn_samples. */
function fakeAdmin() {
  const rows: Row[] = [];
  return {
    rows,
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let asc = true;
      let lim = Infinity;
      let off = 0;
      let del = false;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: number) => (filters.push((r) => r[c] >= v), q),
        lt: (c: string, v: number) => (filters.push((r) => r[c] < v), q),
        order: (_c: string, o: { ascending: boolean }) => ((asc = o.ascending), q),
        limit: (n: number) => ((lim = n), q),
        range: (a: number, b: number) => ((off = a), (lim = b - a + 1), q),
        delete: () => ((del = true), q),
        upsert: async (add: Row[]) => {
          for (const r of add)
            if (!rows.some((x) => x.market === r.market && x.version === r.version && x.t === r.t))
              rows.push(r);
          return { error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (del) {
            for (const r of hit) rows.splice(rows.indexOf(r), 1);
            return resolve({ error: null });
          }
          hit.sort((a, b) => (asc ? a.t - b.t : b.t - a.t));
          resolve({ data: hit.slice(off, off + lim), error: null });
        },
      };
      return q;
    },
  };
}

/** Binance-style rows for a gently trending market; the perpetual can be down. */
function fakeBinance(calls: string[], futuresUp = true): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    if (url.includes("fapi") && !futuresUp) return new Response("no", { status: 451 });
    const u = new URL(url);
    const ms = { "1d": DAY, "1h": 3600_000, "15m": 900_000, "5m": 300_000 }[
      u.searchParams.get("interval") as "1d"
    ];
    const start = Number(u.searchParams.get("startTime"));
    const end = Number(u.searchParams.get("endTime"));
    const rows: unknown[][] = [];
    for (let t = Math.ceil(start / ms) * ms; t < end && rows.length < 1000; t += ms) {
      const mid = 100 + Math.sin(t / 3.6e6) * 3 + (t / 8.64e7) * 0.5;
      rows.push([t, mid, mid + 0.6, mid - 0.6, mid + 0.1, 100]);
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
}

const gold = { code: "XAUUSD", symbol: "PAXGUSDT", futures: "XAUUSDT" };
const NOW = Date.parse("2026-10-29T12:00:00Z");

describe("rangesToReplay", () => {
  it("replays the recent past first, then what's new plus a week further back", () => {
    expect(rangesToReplay(null, NOW)).toEqual([[NOW - REPLAY_DAYS * DAY, NOW]]);
    const kept = { oldest: NOW - 14 * DAY, newest: NOW - 2 * 3600_000 };
    expect(rangesToReplay(kept, NOW)).toEqual([
      [kept.newest + 1, NOW],
      [kept.oldest - BACKFILL_DAYS * DAY, kept.oldest],
    ]);
  });
  it("stops reaching back once the history covers 90 days", () => {
    const kept = { oldest: NOW - LEARN_DAYS * DAY, newest: NOW - 3600_000 };
    expect(rangesToReplay(kept, NOW)).toEqual([[kept.newest + 1, NOW]]);
  });
});

describe("gatherSamples", () => {
  it("keeps every setup and grows the history study by study, from the gold perpetual", async () => {
    const admin = fakeAdmin();
    const calls: string[] = [];
    const first = await gatherSamples(admin, gold, undefined, NOW, fakeBinance(calls));
    expect(first.added).toBeGreaterThan(400);
    expect(first.samples).toHaveLength(admin.rows.length);
    expect(first.days).toBeGreaterThanOrEqual(REPLAY_DAYS - 1);
    expect(calls.every((u) => u.includes("fapi") && u.includes("XAUUSDT"))).toBe(true);
    // Two hours on: the new setups, and a week further back.
    const second = await gatherSamples(admin, gold, undefined, NOW + 2 * 3600_000, fakeBinance([]));
    expect(second.samples.length).toBeGreaterThan(first.samples.length + 300);
    expect(second.days).toBeGreaterThanOrEqual(REPLAY_DAYS + BACKFILL_DAYS - 1);
    // Every setup once, oldest first.
    const ts = second.samples.map((s) => s.t);
    expect(new Set(ts).size).toBe(ts.length);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  }, 60_000);

  it("falls back to the gold token when the perpetual is down", async () => {
    const calls: string[] = [];
    const out = await gatherSamples(fakeAdmin(), gold, undefined, NOW, fakeBinance(calls, false));
    expect(out.samples.length).toBeGreaterThan(400);
    expect(calls.some((u) => u.includes("PAXGUSDT"))).toBe(true);
  }, 60_000);
});
