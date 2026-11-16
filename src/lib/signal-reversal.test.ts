import { beforeEach, describe, expect, test, vi } from "vitest";

// No purge (the live database's purge time would break the pretend clock).
vi.mock("./signal-chat.server", async (orig) => ({
  ...(await orig<object>()),
  chatPurgedAt: async () => null,
}));
// High-frequency mode (the copier card's switch), flipped per test.
let hft = false;
vi.mock("./copy-mirror.server", async (orig) => ({
  ...(await orig<object>()),
  hftOn: async () => hft,
}));
vi.mock("./engine-config.server", async () => {
  const { DEFAULT_ENGINE_CONFIG } = await import("./engine-config");
  return { engineConfig: async () => DEFAULT_ENGINE_CONFIG };
});

import {
  HEDGE_MIN_CONFIDENCE,
  maybeReversalSignal,
  REVERSALS_PER_MARKET,
  reversalRoom,
  tagReversal,
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

const T0 = Date.parse("2026-11-16T10:00:00Z");
const reversalCard = (direction: "BUY" | "SELL", pct = 62) => ({
  reply: `BTCUSD ${direction} reversal card`,
  plan: {
    market: "BTCUSD",
    label: "BTC/USD",
    direction,
    confidencePct: pct,
    entry: 100,
    expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
    feeds: { reversal: true, setup: "Wick rejection" },
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
  hft = false;
});

describe("reversals in high-frequency mode", () => {
  test("off unless high-frequency mode is on: no chart read", async () => {
    const { db } = fakeDb();
    const d = deps(() => reversalCard("BUY"));
    expect(await maybeReversalSignal(db, d)).toBe("off");
    expect(d.asks).toEqual([]);
  });

  test("on: asks each market for a reversal and posts it, named on the card", async () => {
    hft = true;
    const { db } = fakeDb();
    const d = deps((ask) => (ask.startsWith("BTCUSD") ? reversalCard("SELL") : { reply: "wait" }));
    const out = await maybeReversalSignal(db, d);
    expect(out).toContain("BTCUSD SELL: posted");
    expect(out).toContain("XAUUSD: no reversal");
    expect(d.asks).toEqual(["XAUUSD signal 5m reversal:any", "BTCUSD signal 5m reversal:any"]);
    expect(d.sent[0]).toMatch(/🔄 Reversal: Wick rejection, one 1R target/);
  });

  test("at most REVERSALS_PER_MARKET running per market", async () => {
    hft = true;
    expect(reversalRoom([])).toBe(true);
    expect(
      reversalRoom(Array.from({ length: REVERSALS_PER_MARKET }, () => ({ reversal: true }))),
    ).toBe(false);
    expect(reversalRoom([{ reversal: false }, { reversal: true }])).toBe(true);
    const { db, tables } = fakeDb();
    for (let i = 0; i < REVERSALS_PER_MARKET; i++)
      tables.trade_signals.push({
        market: "BTCUSD",
        direction: "BUY",
        sender_worker: "trade",
        status: "open",
        created_at: new Date(T0 - 60_000).toISOString(),
        feeds: { reversal: true },
      });
    const d = deps(() => reversalCard("BUY"));
    await maybeReversalSignal(db, d);
    expect(d.asks).toEqual(["XAUUSD signal 5m reversal:any"]);
  });

  test("under the hedge floor, or a plan not marked reversal: not posted", async () => {
    hft = true;
    const { db } = fakeDb();
    const low = deps(() => reversalCard("BUY", HEDGE_MIN_CONFIDENCE - 1));
    expect(await maybeReversalSignal(db, low)).toContain(`only ${HEDGE_MIN_CONFIDENCE - 1}%`);
    expect(low.sent).toEqual([]);
    const { db: db2 } = fakeDb();
    const plain = { ...reversalCard("BUY"), plan: { ...reversalCard("BUY").plan, feeds: {} } };
    const d = deps(() => plain);
    await maybeReversalSignal(db2, d);
    expect(d.sent).toEqual([]);
  });

  test("checks each market at most every 20 seconds", async () => {
    hft = true;
    const { db } = fakeDb();
    await maybeReversalSignal(
      db,
      deps(() => ({ reply: "wait" })),
    );
    const soon = deps(() => ({ reply: "wait" }), T0 + 10_000);
    expect(await maybeReversalSignal(db, soon)).toBe("not due");
    const later = deps(() => ({ reply: "wait" }), T0 + 21_000);
    await maybeReversalSignal(db, later);
    expect(later.asks).toHaveLength(2);
    expect(tagReversal("card")).toMatch(/a reversal/);
  });
});
