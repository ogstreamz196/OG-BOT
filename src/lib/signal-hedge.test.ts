import { beforeEach, describe, expect, test, vi } from "vitest";

// No purge (the live database's purge time would break the pretend clock).
vi.mock("./signal-chat.server", async (orig) => ({
  ...(await orig<object>()),
  chatPurgedAt: async () => null,
}));
// The Boss's strategy switches: the hedges switch is flipped per test.
let hedgesOn = false;
vi.mock("./engine-config.server", async () => {
  const { DEFAULT_ENGINE_CONFIG } = await import("./engine-config");
  return {
    engineConfig: async () => ({
      ...DEFAULT_ENGINE_CONFIG,
      strategies: { ...DEFAULT_ENGINE_CONFIG.strategies, hedges: hedgesOn },
    }),
  };
});

import {
  HEDGE_MIN_CONFIDENCE,
  hedgeSideFor,
  maybeHedgeSignal,
  tagHedge,
} from "./signal-broadcast.server";

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
