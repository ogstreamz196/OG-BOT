import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceText,
  dealResult,
  followAutoTrades,
  placeAutoTrade,
  tradeRequest,
  type Mt5Trade,
} from "./mt5-autotrade.server";
import type { SignalPlan } from "./trade-signal-context.server";

const plan = (over: Partial<SignalPlan> = {}): SignalPlan => ({
  market: "XAUUSD",
  label: "XAU/USD (Gold)",
  feeds: {},
  style: "scalp",
  timeframe: "5M",
  direction: "BUY",
  entry: 2400.123,
  entryType: "market",
  stop: 2395.456,
  targets: [2403.789, 2406, 2410],
  confidencePct: 75,
  quality: "Clean",
  decimals: 2,
  pip: 0.1,
  expiresAt: "2026-10-28T12:00:00.000Z",
  ...over,
});

/** A tiny in-memory stand-in for the database. */
function fakeDb(settings: Record<string, string>, trades: Mt5Trade[] = []) {
  const tables: Record<string, Record<string, unknown>[]> = {
    site_content: Object.entries(settings).map(([key, value]) => ({ key, value })),
    mt5_trades: trades as unknown as Record<string, unknown>[],
  };
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    let filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    const matches = () => rows.filter((r) => filters.every((f) => f(r)));
    q.select = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.eq = (k: string, v: unknown) => {
      filters.push((r) => r[k] === v);
      if (pendingUpdate) {
        for (const r of matches()) Object.assign(r, pendingUpdate);
        pendingUpdate = null;
        filters = [];
        return Promise.resolve({ error: null });
      }
      return q;
    };
    q.in = (k: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[k]));
      return q;
    };
    // Awaiting the query gives the matching rows.
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({ data: matches(), error: null }).then(ok, bad);
    q.maybeSingle = () => {
      if (pendingInsert) {
        const dup = rows.some((r) => r.setup_key === pendingInsert!.setup_key);
        if (dup) return Promise.resolve({ data: null, error: { code: "23505" } });
        const row = { id: `t${rows.length + 1}`, created_at: "now", ...pendingInsert };
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: matches()[0] ?? null, error: null });
    };
    q.insert = (row: Record<string, unknown>) => {
      pendingInsert = row;
      return q;
    };
    q.update = (patch: Record<string, unknown>) => {
      pendingUpdate = patch;
      return q;
    };
    return q;
  };
  return { db: { from } as never, tables };
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
function metaApi(routes: Record<string, unknown>, status = 200) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      const key = Object.keys(routes).find((k) => url.endsWith(k));
      return new Response(JSON.stringify(key ? routes[key] : null), { status: key ? status : 404 });
    }),
  );
}

beforeEach(() => {
  process.env.METAAPI_TOKEN = "tok";
  process.env.METAAPI_ACCOUNT_ID = "acc";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.METAAPI_TOKEN;
  delete process.env.METAAPI_ACCOUNT_ID;
});

describe("tradeRequest", () => {
  it("market orders: 0.01 lot, the bot's stop, Quick Scalp as take profit, rounded", () => {
    expect(tradeRequest(plan(), "XAUUSD", "tag")).toEqual({
      actionType: "ORDER_TYPE_BUY",
      symbol: "XAUUSD",
      volume: 0.01,
      stopLoss: 2395.46,
      takeProfit: 2403.79,
      comment: "OG B0T",
      clientId: "tag",
    });
  });
  it("limit and stop entries are pending orders that expire with the signal", () => {
    const sell = tradeRequest(plan({ direction: "SELL", entryType: "limit" }), "XAUUSD", "t");
    expect(sell).toMatchObject({
      actionType: "ORDER_TYPE_SELL_LIMIT",
      openPrice: 2400.12,
      expiration: { type: "ORDER_TIME_SPECIFIED", time: "2026-10-28T12:00:00.000Z" },
    });
    expect(tradeRequest(plan({ entryType: "stop" }), "XAUUSD", "t").actionType).toBe(
      "ORDER_TYPE_BUY_STOP",
    );
  });
});

describe("placeAutoTrade", () => {
  it("does nothing until the Boss switches it on", async () => {
    metaApi({});
    const { db } = fakeDb({});
    expect(await placeAutoTrade(db, plan())).toBe("skipped: switched off");
    expect(calls).toHaveLength(0);
  });
  it("never trades bias calls, other markets or under 70%", async () => {
    metaApi({});
    const { db } = fakeDb({ "mt5.autotrade": "on" });
    expect(await placeAutoTrade(db, plan({ feeds: { bias: true } }))).toBe("skipped: bias call");
    expect(await placeAutoTrade(db, plan({ market: "EURUSD" }))).toBe("skipped: market");
    expect(await placeAutoTrade(db, plan({ confidencePct: 69 }))).toBe("skipped: under 70%");
    expect(calls).toHaveLength(0);
  });
  it("places the trade once per setup and records it", async () => {
    metaApi({ "/trade": { stringCode: "TRADE_RETCODE_DONE", orderId: "555", positionId: "555" } });
    const { db, tables } = fakeDb({ "mt5.autotrade": "on" });
    expect(await placeAutoTrade(db, plan())).toBe("opened");
    expect(calls[0].url).toBe(
      "https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/acc/trade",
    );
    expect(calls[0].body).toMatchObject({ actionType: "ORDER_TYPE_BUY", volume: 0.01 });
    expect(tables.mt5_trades[0]).toMatchObject({ status: "open", ticket: "555" });
    // The same setup again (another scan pass): no second trade.
    expect(await placeAutoTrade(db, plan())).toBe("skipped: already traded");
    expect(calls).toHaveLength(1);
  });
  it("records a broker rejection as failed", async () => {
    metaApi({ "/trade": { stringCode: "TRADE_RETCODE_INVALID_STOPS", message: "Invalid stops" } });
    const { db, tables } = fakeDb({ "mt5.autotrade": "on" });
    expect(await placeAutoTrade(db, plan())).toBe("failed: Invalid stops");
    expect(tables.mt5_trades[0]).toMatchObject({ status: "failed", error: "Invalid stops" });
  });
});

const trade = (over: Partial<Mt5Trade>): Mt5Trade => ({
  id: "t1",
  setup_key: "k",
  market: "XAUUSD",
  label: "Gold",
  symbol: "XAUUSD",
  direction: "BUY",
  order_type: "ORDER_TYPE_BUY",
  volume: 0.01,
  entry: 2400,
  stop_loss: 2395,
  take_profit: 2403,
  confidence_pct: 75,
  ticket: "9",
  status: "open",
  error: null,
  profit: null,
  expires_at: null,
  opened_at: null,
  closed_at: null,
  created_at: "now",
  ...over,
});

describe("followAutoTrades", () => {
  it("closes a position that's gone, with its real result", async () => {
    metaApi({
      "/positions": [],
      "/orders": [],
      "/history-deals/position/9": [
        { profit: 0, commission: -0.1 },
        { profit: 3.2, swap: -0.05 },
      ],
    });
    const { db, tables } = fakeDb({}, [trade({})]);
    expect(await followAutoTrades(db)).toBe(1);
    expect(tables.mt5_trades[0]).toMatchObject({ status: "closed", profit: 3.05 });
  });
  it("marks a filled pending order open, and leaves running trades alone", async () => {
    metaApi({ "/positions": [{ id: "9" }, { id: "10" }], "/orders": [] });
    const { db, tables } = fakeDb({}, [
      trade({ status: "pending" }),
      trade({ id: "t2", ticket: "10", setup_key: "k2" }),
    ]);
    expect(await followAutoTrades(db)).toBe(1);
    expect(tables.mt5_trades.map((t) => t.status)).toEqual(["open", "open"]);
  });
  it("judges nothing when MetaApi can't be read", async () => {
    metaApi({ "/positions": [], "/orders": [] }, 500);
    const { db, tables } = fakeDb({}, [trade({})]);
    expect(await followAutoTrades(db)).toBe(0);
    expect(tables.mt5_trades[0].status).toBe("open");
  });
});

describe("copy bot posts", () => {
  it("open and close messages", () => {
    expect(announceText(trade({}), "opened")).toContain("🟢 BOUGHT XAUUSD 0.01 lot");
    const closed = announceText(trade({ status: "closed", profit: 3.05 }), "closed");
    expect(closed).toContain("✅ CLOSED IN PROFIT");
    expect(closed).toContain("+$3.05");
    expect(announceText(trade({ profit: -5 }), "closed")).toContain("−$5.00");
  });
  it("adds up profit, swap and commission", () => {
    expect(dealResult([{ profit: 10 }, { swap: -1.255, commission: -0.5 }])).toBe(8.25);
  });
});
