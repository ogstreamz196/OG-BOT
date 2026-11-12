import { beforeEach, describe, expect, test, vi } from "vitest";

// No purge (the live database's purge time would break the pretend clock).
vi.mock("./signal-chat.server", async (orig) => ({
  ...(await orig<object>()),
  chatPurgedAt: async () => null,
}));
// The Boss's strategy switches: the hedges switch is flipped per test.
let hedgesOn = false;
let rangeOn = false;
let alongsideOn = false;
vi.mock("./engine-config.server", async () => {
  const { DEFAULT_ENGINE_CONFIG } = await import("./engine-config");
  return {
    engineConfig: async () => ({
      ...DEFAULT_ENGINE_CONFIG,
      strategies: {
        ...DEFAULT_ENGINE_CONFIG.strategies,
        hedges: hedgesOn,
        rangeHedge: rangeOn,
        patternsAlongside: alongsideOn,
      },
    }),
  };
});

import {
  HEDGE_MIN_CONFIDENCE,
  hedgeSideFor,
  maybeAlongside,
  maybeHedgeSignal,
  maybeRangeHedge,
  rangeSidesFree,
  tagAlongside,
  tagHedge,
  tagRangeHedge,
} from "./signal-broadcast.server";
import { rangeHedgePlan, type SetupHit } from "./trade-setups";
import type { TradePlan } from "./trade-signal";

type Row = Record<string, unknown>;

/** Just enough of the database client for the hedge step and postOnce. */
function fakeDb() {
  const tables: Record<string, Row[]> = {
    signal_broadcasts: [],
    trade_signals: [],
    site_content: [],
  };
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    const result = () => ({ data: rows.filter((r) => filters.every((f) => f(r))), error: null });
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      gte: (c: string, v: unknown) => (filters.push((r) => String(r[c]) >= String(v)), q),
      maybeSingle: () => Promise.resolve({ data: result().data[0] ?? null, error: null }),
      insert: (row: Row) => (rows.push(row), Promise.resolve({ error: null })),
      upsert: (row: Row) => {
        const i = rows.findIndex((r) => r.key === row.key);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve(result()),
    };
    return q;
  };
  return { db: { from }, tables };
}

const T0 = Date.parse("2026-11-12T10:00:00Z");
const running = (market: string, direction: "BUY" | "SELL", hedge = false): Row => ({
  market,
  direction,
  sender_worker: "trade",
  status: "open",
  created_at: new Date(T0 - 30 * 60_000).toISOString(),
  feeds: hedge ? { hedge: true } : {},
});
const hedgeCard = (direction: "BUY" | "SELL", pct = 60) => ({
  reply: `BTCUSD ${direction} hedge card`,
  plan: {
    market: "BTCUSD",
    label: "BTC/USD",
    direction,
    confidencePct: pct,
    entry: 100,
    expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
    feeds: { hedge: true },
  },
});

function deps(built: (ask: string) => unknown, now = T0) {
  const asks: string[] = [];
  const sent: string[] = [];
  return {
    asks,
    sent,
    build: async (ask: string) => (asks.push(ask), built(ask)) as never,
    post: async (text: string) => (sent.push(text), sent.length),
    now: () => now,
  };
}

beforeEach(() => {
  hedgesOn = false;
  rangeOn = false;
  alongsideOn = false;
});

describe("which side a hedge takes", () => {
  test("the other side of trend trades that all lean one way", () => {
    expect(hedgeSideFor([{ direction: "BUY" }, { direction: "BUY" }])).toBe("SELL");
    expect(hedgeSideFor([{ direction: "SELL" }])).toBe("BUY");
  });
  test("none with nothing running, both sides running, or a hedge already on", () => {
    expect(hedgeSideFor([])).toBeNull();
    expect(hedgeSideFor([{ direction: "BUY" }, { direction: "SELL" }])).toBeNull();
    expect(hedgeSideFor([{ direction: "BUY" }, { direction: "SELL", hedge: true }])).toBeNull();
  });
  test("the card says it's a hedge", () => {
    expect(tagHedge("card")).toMatch(/^card\n🛡 Hedge/);
  });
});

describe("the hedge step in the scan", () => {
  test("off by default: nothing read, nothing posted", async () => {
    const { db, tables } = fakeDb();
    tables.trade_signals.push(running("BTCUSD", "BUY"));
    const d = deps(() => hedgeCard("SELL"));
    expect(await maybeHedgeSignal(db, d)).toBe("off");
    expect(d.asks).toEqual([]);
  });

  test("switched on: asks for a hedge on the other side and posts it, tagged", async () => {
    hedgesOn = true;
    const { db, tables } = fakeDb();
    tables.trade_signals.push(running("BTCUSD", "BUY"), running("BTCUSD", "BUY"));
    const d = deps(() => hedgeCard("SELL"));
    expect(await maybeHedgeSignal(db, d)).toBe("BTCUSD SELL: posted");
    expect(d.asks).toEqual(["BTCUSD signal 5m hedge:SELL"]);
    expect(d.sent[0]).toMatch(/BTCUSD SELL hedge card[\s\S]*🛡 Hedge/);
  });

  test("checks each market at most once a minute", async () => {
    hedgesOn = true;
    const { db, tables } = fakeDb();
    tables.trade_signals.push(running("BTCUSD", "BUY"));
    const d = deps(() => ({ reply: "wait" }));
    expect(await maybeHedgeSignal(db, d)).toBe("BTCUSD SELL: no hedge setup");
    expect(
      await maybeHedgeSignal(
        db,
        deps(() => ({ reply: "wait" }), T0 + 30_000),
      ),
    ).toBe("no running trend trade to hedge");
    const later = deps(() => ({ reply: "wait" }), T0 + 61_000);
    await maybeHedgeSignal(db, later);
    expect(later.asks).toHaveLength(1);
  });

  test("no hedge while one is already running, or under its floor", async () => {
    hedgesOn = true;
    const { db, tables } = fakeDb();
    tables.trade_signals.push(running("BTCUSD", "BUY"), running("BTCUSD", "SELL", true));
    const d = deps(() => hedgeCard("SELL"));
    expect(await maybeHedgeSignal(db, d)).toBe("no running trend trade to hedge");
    expect(d.asks).toEqual([]);

    const { db: db2, tables: t2 } = fakeDb();
    t2.trade_signals.push(running("BTCUSD", "BUY"));
    const low = deps(() => hedgeCard("SELL", HEDGE_MIN_CONFIDENCE - 1));
    expect(await maybeHedgeSignal(db2, low)).toBe(`BTCUSD SELL: only ${HEDGE_MIN_CONFIDENCE - 1}%`);
    expect(low.sent).toEqual([]);
  });

  test("a plain signal (not a hedge) on the build is never posted as one", async () => {
    hedgesOn = true;
    const { db, tables } = fakeDb();
    tables.trade_signals.push(running("BTCUSD", "BUY"));
    const notHedge = { ...hedgeCard("SELL"), plan: { ...hedgeCard("SELL").plan, feeds: {} } };
    const d = deps(() => notHedge);
    expect(await maybeHedgeSignal(db, d)).toBe("BTCUSD SELL: no hedge setup");
    expect(d.sent).toEqual([]);
  });
});

const rangeCard = (direction: "BUY" | "SELL", pct = 62) => ({
  reply: `XAUUSD ${direction} range card`,
  plan: {
    market: "XAUUSD",
    label: "Gold",
    direction,
    confidencePct: pct,
    entry: 100,
    expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
    feeds: { hedge: true, rangeHedge: true },
  },
});

describe("range hedging", () => {
  // A range from 96 to 104 (middle 100); price closed at 96.5 going up: a buy
  // at the bottom edge, stop 0.3 ATR (ATR 1) under the bottom.
  const hit: SetupHit = {
    id: "range_fade",
    direction: "BUY",
    entry: 96.5,
    risk: 0.8,
    targets: [100, 103.2, 104],
    atr: 1,
    confidencePct: 62,
  };
  const base = { market: "XAUUSD" } as unknown as TradePlan;

  test("one quick target at the middle, the setup's stop, tagged as a (range) hedge", () => {
    const p = rangeHedgePlan(base, hit, 96.6)!;
    expect(p).toMatchObject({
      direction: "BUY",
      entry: 96.6,
      entryType: "market",
      stop: 95.7,
      targets: [100, 100, 100],
      verdict: "trade",
      hedge: true,
      rangeHedge: true,
    });
    expect(p.entryNote).toMatch(/bottom of the range/);
  });

  test("not for another setup, or once price has run off", () => {
    expect(rangeHedgePlan(base, { ...hit, id: "wick_rejection" }, 96.6)).toBeNull();
    expect(rangeHedgePlan(base, hit, 97.0)).toBeNull(); // 0.5 away > half the 0.8 risk
  });

  test("at most one buy and one sell at a time", () => {
    expect(rangeSidesFree([])).toEqual(["BUY", "SELL"]);
    expect(rangeSidesFree([{ direction: "BUY", rangeHedge: true }])).toEqual(["SELL"]);
    expect(rangeSidesFree([{ direction: "BUY" }, { direction: "SELL" }])).toEqual(["BUY", "SELL"]);
    expect(
      rangeSidesFree([
        { direction: "BUY", rangeHedge: true },
        { direction: "SELL", rangeHedge: true },
      ]),
    ).toEqual([]);
    expect(tagRangeHedge("card")).toMatch(/^card\n🔁 Range hedge/);
  });

  test("off by default: no chart read", async () => {
    const { db } = fakeDb();
    const d = deps(() => rangeCard("BUY"));
    expect(await maybeRangeHedge(db, d)).toBe("off");
    expect(d.asks).toEqual([]);
  });

  test("switched on: asks both edges, posts the one showing", async () => {
    rangeOn = true;
    const { db } = fakeDb();
    const d = deps((ask) =>
      ask.startsWith("XAUUSD") && ask.endsWith("range:BUY") ? rangeCard("BUY") : { reply: "wait" },
    );
    const out = await maybeRangeHedge(db, d);
    expect(out).toContain("XAUUSD BUY: posted");
    expect(out).toContain("BTCUSD: not ranging at an edge");
    expect(d.asks).toEqual(
      expect.arrayContaining(["XAUUSD signal 5m range:BUY", "XAUUSD signal 5m range:SELL"]),
    );
    expect(d.sent[0]).toMatch(/XAUUSD BUY range card[\s\S]*🔁 Range hedge/);
  });

  test("an edge with a range hedge running isn't asked again", async () => {
    rangeOn = true;
    const { db, tables } = fakeDb();
    tables.trade_signals.push({
      market: "XAUUSD",
      direction: "BUY",
      sender_worker: "trade",
      status: "open",
      created_at: new Date(T0 - 60_000).toISOString(),
      feeds: { hedge: true, rangeHedge: true },
    });
    const d = deps(() => ({ reply: "wait" }));
    await maybeRangeHedge(db, d);
    expect(d.asks.filter((a) => a.startsWith("XAUUSD"))).toEqual(["XAUUSD signal 5m range:SELL"]);
  });
});

describe("patterns alongside", () => {
  const proven = (direction: "BUY" | "SELL") => ({
    reply: `BTCUSD ${direction} flag card`,
    plan: {
      market: "BTCUSD",
      label: "BTC/USD",
      direction,
      confidencePct: 72,
      entry: 100,
      expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
      feeds: { alongside: true, setup: "Flag continuation" },
    },
  });

  test("off by default: no chart read", async () => {
    const { db } = fakeDb();
    const d = deps(() => proven("BUY"));
    expect(await maybeAlongside(db, d)).toBe("off");
    expect(d.asks).toEqual([]);
  });

  test("switched on: asks each market for a proven pattern and posts it, named", async () => {
    alongsideOn = true;
    const { db } = fakeDb();
    const d = deps((ask) => (ask.startsWith("BTCUSD") ? proven("BUY") : { reply: "wait" }));
    const out = await maybeAlongside(db, d);
    expect(out).toContain("BTCUSD BUY: posted");
    expect(out).toContain("XAUUSD: no proven pattern");
    expect(d.asks).toEqual(["XAUUSD signal 5m alongside", "BTCUSD signal 5m alongside"]);
    expect(d.sent[0]).toMatch(/➕ Alongside the engine: Flag continuation/);
  });

  test("the engine's own trade (not marked alongside) is never posted by this step", async () => {
    alongsideOn = true;
    const { db } = fakeDb();
    const engineOwn = { ...proven("BUY"), plan: { ...proven("BUY").plan, feeds: {} } };
    const d = deps(() => engineOwn);
    await maybeAlongside(db, d);
    expect(d.sent).toEqual([]);
  });

  test("once a minute per market", async () => {
    alongsideOn = true;
    const { db } = fakeDb();
    await maybeAlongside(
      db,
      deps(() => ({ reply: "wait" })),
    );
    const soon = deps(() => ({ reply: "wait" }), T0 + 30_000);
    expect(await maybeAlongside(db, soon)).toBe("not due");
    expect(soon.asks).toEqual([]);
    expect(tagAlongside("card")).toMatch(/a proven pattern/);
  });
});
