import { describe, expect, it, vi } from "vitest";

vi.mock("./copy-settings-bot.server", () => ({
  isBossChat: async (_a: unknown, id: number) => ({ ok: id === 1, userId: "boss" }),
}));
vi.mock("./signal-chat.server", () => ({ signalsChatId: async () => -100 }));

import {
  CLOSE_ASK_KEY,
  closePanel,
  closeTradesReply,
  closeTradesTap,
  dueCloseIds,
  HALF_KEY,
  inProfit,
  openPnl,
  parseCloseTap,
  type OpenTrade,
} from "./close-trades.server";

const ID = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const gold = (id: string, dir: "BUY" | "SELL", entry: number, last: number): OpenTrade => ({
  id,
  market: "XAUUSD",
  direction: dir,
  entry,
  last,
  lots: 0.1,
});

/** site_content rows, the open trades and the audit log. */
function fakeDb(rows: Record<string, unknown>[]) {
  const store = new Map<string, string>();
  const audit: unknown[] = [];
  const from = (table: string) => {
    const f: { key?: unknown } = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (c === "key" && (f.key = v), q),
      in: () => q,
      not: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: store.has(String(f.key)) ? { value: store.get(String(f.key)) } : null,
      }),
      upsert: async (r: { key: string; value: string }) => (store.set(r.key, r.value), {}),
      insert: (r: unknown) => (table === "boss_audit_log" && audit.push(r), Promise.resolve({})),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: table === "trade_signals" ? rows : [] }),
    };
    return q;
  };
  return { db: { from }, store, audit };
}

const row = (n: number, dir: "BUY" | "SELL", entry: number, last: number) => ({
  id: ID(n),
  market: "XAUUSD",
  direction: dir,
  entry,
  last_price: last,
  entered_at: "2026-11-22T10:00:00Z",
  feeds: { paper: { lots: 0.1 } },
});

describe("the Boss's close trades card", () => {
  it("works out which trades are in profit and by how much", () => {
    expect(inProfit(gold(ID(1), "BUY", 4000, 4003))).toBe(true);
    expect(inProfit(gold(ID(2), "SELL", 4000, 4003))).toBe(false);
    // 0.1 lot of gold = 10 oz: $3 up is +$30.
    expect(openPnl(gold(ID(1), "BUY", 4000, 4003))).toBe(30);
    expect(openPnl({ ...gold(ID(1), "BUY", 4000, 0), last: null })).toBeNull();
  });

  it("offers close all in profit and close half, each with a confirm", () => {
    const trades = [gold(ID(1), "BUY", 4000, 4003), gold(ID(2), "SELL", 4000, 4003)];
    const p = closePanel(trades);
    expect(p.text).toMatch(/Running now: 2 · in profit: 1 \(\+\$30\.00/);
    const datas = p.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toEqual(expect.arrayContaining(["ct:ask:profit", "ct:ask:half", "ct:close"]));
    const c = closePanel(trades, { confirming: "profit" });
    expect(c.reply_markup.inline_keyboard[0][0].callback_data).toBe("ct:go:profit");
    // Nothing in profit: no close buttons.
    const none = closePanel([trades[1]])
      .reply_markup.inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(none).not.toContain("ct:ask:profit");
    expect(parseCloseTap("ct:go:half")).toEqual({ run: "half" });
    expect(parseCloseTap("ct:nope")).toBeNull();
  });

  it("close all in profit asks the tracker to close only the winners, for 5 minutes", async () => {
    const { db, store, audit } = fakeDb([row(1, "BUY", 4000, 4003), row(2, "SELL", 4000, 4003)]);
    const r = await closeTradesTap(db, 1, "ct:go:profit");
    expect(r.toast).toMatch(/Closing/);
    const now = Date.now();
    expect([...dueCloseIds(store.get(CLOSE_ASK_KEY), now)]).toEqual([ID(1)]);
    expect(dueCloseIds(store.get(CLOSE_ASK_KEY), now + 6 * 60_000).size).toBe(0);
    expect(audit).toHaveLength(1);
  });

  it("close half adds the winners to the copiers' half-close list", async () => {
    const { db, store } = fakeDb([row(1, "BUY", 4000, 4003), row(3, "BUY", 4000, 4010)]);
    await closeTradesTap(db, 1, "ct:go:half");
    expect(JSON.parse(store.get(HALF_KEY)!).ids).toEqual([ID(1), ID(3)]);
  });

  it("Boss only, and the card opens from the button or /close", async () => {
    const { db, store } = fakeDb([row(1, "BUY", 4000, 4003)]);
    expect((await closeTradesTap(db, 2, "ct:go:profit")).panel).toBeNull();
    expect(store.size).toBe(0);
    expect(await closeTradesReply(db, 2, "💰 Close trades")).toBeNull();
    expect((await closeTradesReply(db, 1, "/close"))?.text).toMatch(/CLOSE TRADES/);
    expect(await closeTradesReply(db, 1, "hello")).toBeNull();
  });
});
