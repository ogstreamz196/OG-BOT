import { describe, expect, it, vi } from "vitest";

// The live price and plan for a manual trade (buildTradeSignal's "manual:" ask).
vi.mock("./trade-signal-context.server", () => ({
  buildTradeSignal: async (ask: string) => {
    const m = /manual:(BUY|SELL):([\d.]+):([\d.]+)/.exec(ask)!;
    const [dir, sl, tp] = [m[1], Number(m[2]), Number(m[3])];
    const entry = 4000;
    const s = dir === "BUY" ? 1 : -1;
    return {
      plan: {
        market: "XAUUSD",
        label: "Gold",
        direction: dir,
        entry,
        entryType: "market",
        stop: entry - s * sl,
        targets: [entry + s * tp, entry + s * tp, entry + s * tp],
        confidencePct: 100,
        decimals: 2,
        feeds: { manual: true, lock: true },
      },
    };
  },
}));
const recorded: Record<string, unknown>[] = [];
vi.mock("./trade-signal-tracker.server", () => ({
  recordSignal: async (o: Record<string, unknown>) => {
    recorded.push(o);
  },
}));

import {
  applyManualTap,
  DEFAULT_DRAFT,
  manualKeyboard,
  manualText,
  parseDraft,
} from "./manual-trade-bot.server";
import { manualCard, manualFeeds, placeOwnTrade } from "./manual-trade.server";
import { newKey, revokeKey, setPaused } from "./copier-keys";
import { copySignal } from "./copy-feed";

const NOW = Date.now();
const admin = { from: () => ({ insert: () => Promise.resolve({}) }) };
const key = (over: Record<string, unknown> = {}) => ({
  ...newKey("a".repeat(64), "Sam", 30, NOW),
  balance: 1000,
  ...over,
});
const where = () => {
  const posts: string[] = [];
  return { posts, post: async (t: string) => (posts.push(t), 77) };
};

describe("manual trades: the same card for everyone, a hidden trailing stop", () => {
  it("the card has the hidden trailing stop switch (on by default) and says where the trade goes", () => {
    expect(DEFAULT_DRAFT.trail).toBe(true);
    expect(parseDraft("{}").trail).toBe(true);
    expect(parseDraft(JSON.stringify({ trail: false })).trail).toBe(false);
    const datas = manualKeyboard(DEFAULT_DRAFT)
      .inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(datas).toContain("mt:trail");
    expect(applyManualTap(DEFAULT_DRAFT, "mt:trail").draft?.trail).toBe(false);
    expect(manualText(DEFAULT_DRAFT, null)).toMatch(/Hidden trailing stop: ON/);
    const confirm = { ...DEFAULT_DRAFT, confirming: true };
    expect(manualText(confirm, null, undefined, "group")).toMatch(/every copier copies it/);
    expect(manualText(confirm, 1000, undefined, "own")).toMatch(/Your copier opens it/);
    // The buttons are identical for the Boss and members.
    expect(manualKeyboard(DEFAULT_DRAFT)).toEqual(manualKeyboard({ ...DEFAULT_DRAFT }));
  });

  it("the stop is hidden; with the trail on, the trailing stop replaces the profit lock", () => {
    expect(manualFeeds({ manual: true, lock: true }, { trail: true, sl: 3 })).toEqual({
      manual: true,
      hiddenStop: true,
      trail: { risk: 3 },
    });
    expect(manualFeeds({ manual: true, lock: true }, { trail: false, sl: 3 })).toEqual({
      manual: true,
      lock: true,
      hiddenStop: true,
    });
  });

  it("the copier is told never to put a manual trade's stop on the broker", () => {
    const row = {
      id: "x",
      market: "XAUUSD",
      direction: "BUY" as const,
      entry: 4000,
      stop: 3997,
      tp1: 4006,
      tp3: 4006,
      status: "open",
      best_target: 0,
      entered_at: "2026-11-22T10:00:00Z",
      closed_at: null,
      created_at: "2026-11-22T10:00:00Z",
      confidence_pct: 100,
    };
    expect(copySignal({ ...row, feeds: { manual: true, hiddenStop: true } }).hiddenStop).toBe(true);
    expect(copySignal({ ...row, feeds: {} }).hiddenStop).toBe(false);
    expect(
      manualCard({
        market: "XAUUSD",
        direction: "BUY",
        entry: 1,
        stop: 0,
        tp: 2,
        lot: 0.1,
        fmt: String,
        own: true,
      }),
    ).toMatch(/Your manual trade · 0\.1 lot/);
  });

  it("a member's trade: their own copier only, tracked, posted in their chat", async () => {
    recorded.length = 0;
    const w = where();
    const k = key();
    const r = await placeOwnTrade(admin, {
      userId: "u1",
      chatId: 555,
      botId: "copybot",
      key: k,
      draft: { ...DEFAULT_DRAFT, lot: 0.05 },
      post: w.post,
    });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/hidden trailing stop on/);
    expect(w.posts[0]).toMatch(/Your manual trade · 0\.05 lot/);
    const rec = recorded[0] as {
      chatId: number;
      senderWorker: string;
      messageId: number;
      plan: { feeds: Record<string, unknown> };
    };
    expect(rec.chatId).toBe(555);
    expect(rec.senderWorker).toBe("copybot");
    expect(rec.messageId).toBe(77);
    expect(rec.plan.feeds).toMatchObject({
      owner: k.id,
      manual: true,
      hiddenStop: true,
      trail: { risk: 3 },
    });
    expect(rec.plan.feeds.lock).toBeUndefined();
  });

  it("risk % sizes from the member's own balance", async () => {
    recorded.length = 0;
    const r = await placeOwnTrade(admin, {
      userId: "u1",
      chatId: 555,
      botId: "b",
      key: key({ balance: 2000 }),
      draft: { ...DEFAULT_DRAFT, lot: null, riskPct: 1 },
      post: where().post,
    });
    expect(r.ok).toBe(true);
    // 1% of $2,000 = $20; a $3 gold stop is $300 a lot → 0.06 lot.
    expect(
      (recorded[0] as { plan: { feeds: { paper: { lots: number } } } }).plan.feeds.paper.lots,
    ).toBe(0.06);
    const none = await placeOwnTrade(admin, {
      userId: "u1",
      chatId: 555,
      botId: "b",
      key: key({ balance: undefined }),
      draft: { ...DEFAULT_DRAFT, lot: null, riskPct: 1 },
      post: where().post,
    });
    expect(none.ok).toBe(false);
    expect(none.text).toMatch(/needs your copier's balance/);
  });

  it("refused when their token is off, run out or they've paused new trades", async () => {
    const go = (k: ReturnType<typeof key>) =>
      placeOwnTrade(admin, {
        userId: "u",
        chatId: 1,
        botId: "b",
        key: k,
        draft: DEFAULT_DRAFT,
        post: where().post,
      });
    expect((await go(revokeKey(key()) as ReturnType<typeof key>)).text).toMatch(/switched off/);
    expect((await go(key({ expiresAt: new Date(NOW - 1000).toISOString() }))).text).toMatch(
      /run out/,
    );
    expect((await go(setPaused(key(), true) as ReturnType<typeof key>)).text).toMatch(/paused/);
  });
});
