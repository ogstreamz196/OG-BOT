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
  HOLD_EVERY_MS,
  holdRoom,
  HOLDS_PER_MARKET,
  maybeHoldSignal,
  tagHold,
} from "./signal-broadcast.server";
import { HOLD_FILL_MINUTES, HOLD_HOURS } from "./trade-signal-context.server";

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
const holdCard = (direction: "BUY" | "SELL", pct = 72) => ({
  reply: `BTCUSD ${direction} trend card`,
  plan: {
    market: "BTCUSD",
    label: "BTC/USD",
    direction,
    confidencePct: pct,
    entry: 100,
    expiresAt: new Date(T0 + 12 * 3600_000).toISOString(),
    feeds: { hold: true, trail: { risk: 5 }, fillWithin: 60 },
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

describe("long holds in high-frequency mode", () => {
  test("off unless high-frequency mode is on: no chart read", async () => {
    const { db } = fakeDb();
    const d = deps(() => holdCard("BUY"));
    expect(await maybeHoldSignal(db, d)).toBe("off");
    expect(d.asks).toEqual([]);
  });

  test("on: asks each market's 15-minute chart for a hold and posts it, tagged", async () => {
    hft = true;
    const { db } = fakeDb();
    const d = deps((ask) => (ask.startsWith("BTCUSD") ? holdCard("BUY") : { reply: "wait" }));
    const out = await maybeHoldSignal(db, d);
    expect(out).toContain("BTCUSD BUY: posted");
    expect(out).toContain("XAUUSD: no hold");
    expect(d.asks).toEqual(["XAUUSD signal 15m hold:long", "BTCUSD signal 15m hold:long"]);
    expect(d.sent[0]).toMatch(/🕰 Long hold: with the bigger trend/);
  });

  test("one long hold per market at a time", async () => {
    hft = true;
    expect(holdRoom([])).toBe(true);
    expect(holdRoom(Array.from({ length: HOLDS_PER_MARKET }, () => ({ hold: true })))).toBe(false);
    const { db, tables } = fakeDb();
    tables.trade_signals.push({
      market: "BTCUSD",
      direction: "BUY",
      sender_worker: "trade",
      status: "open",
      created_at: new Date(T0 - 3600_000).toISOString(),
      feeds: { hold: true },
    });
    const d = deps(() => holdCard("BUY"));
    await maybeHoldSignal(db, d);
    expect(d.asks).toEqual(["XAUUSD signal 15m hold:long"]);
  });

  test("a plan not marked hold isn't posted; each market is asked at most every 5 minutes", async () => {
    hft = true;
    const { db } = fakeDb();
    const plain = { ...holdCard("BUY"), plan: { ...holdCard("BUY").plan, feeds: {} } };
    const d = deps(() => plain);
    await maybeHoldSignal(db, d);
    expect(d.sent).toEqual([]);
    expect(
      await maybeHoldSignal(
        db,
        deps(() => plain, T0 + 60_000),
      ),
    ).toBe("not due");
    const later = deps(() => plain, T0 + HOLD_EVERY_MS + 1000);
    await maybeHoldSignal(db, later);
    expect(later.asks).toHaveLength(2);
    expect(tagHold("card")).toMatch(/up to 12 hours/);
    expect(HOLD_HOURS).toBe(12);
    expect(HOLD_FILL_MINUTES).toBe(60);
  });
});
