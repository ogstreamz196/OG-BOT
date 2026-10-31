import { vi, describe, expect, test } from "vitest";
import {
  BROADCAST_MIN_CONFIDENCE,
  channelCard,
  scanAndBroadcast,
  type ScanDeps,
} from "./signal-broadcast.server";

// The signals chat's purge time comes from the live database; tests must
// never read it (with real credentials, a recent purge hid every test post).
vi.mock("./signal-chat.server", async (real) => ({
  ...(await real<object>()),
  chatPurgedAt: async () => null,
}));

type Row = Record<string, unknown>;

/** Just enough of the database client for signal_broadcasts. */
function fakeDb(opts: { broken?: boolean } = {}) {
  const tables: Record<string, Row[]> = { signal_broadcasts: [], trade_signals: [] };
  const rows = tables.signal_broadcasts;
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      gte: (c: string, v: unknown) => (filters.push((r) => String(r[c]) >= String(v)), q),
      insert: (row: Row) => {
        rows.push({ created_at: new Date().toISOString(), ...row });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => void) =>
        resolve(
          opts.broken
            ? { data: null, error: { message: "relation does not exist" } }
            : { data: rows.filter((r) => filters.every((f) => f(r))).reverse(), error: null },
        ),
    };
    return q;
  };
  return { db: { from }, rows, tables };
}

const T0 = Date.parse("2026-10-25T12:00:00Z");
const card = (market: string, direction: "BUY" | "SELL", confidencePct: number, mins = 60) => ({
  reply: `${market} ${direction} card\n\n⚠️ THIS AIN'T FINANCIAL ADVICE YOU BRAINLESS MUG. RISK 1–2% OR BLAME YOUR MUM.`,
  plan: {
    market,
    label: market,
    direction,
    confidencePct,
    entry: 100,
    expiresAt: new Date(T0 + mins * 60_000).toISOString(),
  },
});

function deps(
  signals: Record<string, ReturnType<typeof card> | { reply: string }>,
  now = T0,
): ScanDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    build: async (ask) => signals[ask.startsWith("XAU") ? "XAU" : "BTC"],
    post: async (text) => (sent.push(text), sent.length),
    now: () => now,
  };
}

describe("auto-posted scalp signals", () => {
  test("trades from 70% confidence are posted, TOP only at 90%", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: card("BTCUSD", "SELL", 70) });
    const result = await scanAndBroadcast(db, d);
    expect(result).toEqual({ checked: 2, posted: ["XAUUSD BUY", "BTCUSD SELL"] });
    expect(d.sent).toHaveLength(2);
    expect(d.sent[0]).toMatch(/^XAUUSD BUY card/);
    expect(d.sent[1]).toMatch(/^BTCUSD SELL card/);
    expect(d.sent[0]).toContain("THIS AIN'T FINANCIAL ADVICE");
    expect(BROADCAST_MIN_CONFIDENCE).toBe(70);
  });

  test("under 70% isn't posted", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 69), BTC: card("BTCUSD", "SELL", 51) });
    expect(await scanAndBroadcast(db, d)).toEqual({ checked: 2, posted: [] });
  });

  test("a 'wait' (no trade) is never posted", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: { reply: "wait card" }, BTC: { reply: "wait card" } });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
  });

  test("successfully posted signals register the exact delivered message for follow-ups", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: { reply: "" } });
    const followed: number[] = [];
    d.follow = async (_signal, id) => {
      followed.push(id);
    };
    await scanAndBroadcast(db, d);
    expect(followed).toEqual([1]);
  });

  test("no repeats while a post is valid, unless it flips; posts again once it expires", async () => {
    const { db } = fakeDb();
    const gold = { XAU: card("XAUUSD", "BUY", 90, 60), BTC: { reply: "" } };
    expect((await scanAndBroadcast(db, deps(gold))).posted).toEqual(["XAUUSD BUY"]);
    // A minute later, same call: not again.
    expect((await scanAndBroadcast(db, deps(gold, T0 + 60_000))).posted).toEqual([]);
    // It flips to a SELL: that's news, so it goes out.
    const flipped = { XAU: card("XAUUSD", "SELL", 90, 60), BTC: { reply: "" } };
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 120_000))).posted).toEqual([
      "XAUUSD SELL",
    ]);
    // After the post's valid-until, a fresh one can go out.
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 61 * 60_000))).posted).toEqual([
      "XAUUSD SELL",
    ]);
  });

  test("the same side goes out again once the last alert's trade is over", async () => {
    const { db, tables } = fakeDb();
    const gold = { XAU: card("XAUUSD", "BUY", 90, 60), BTC: { reply: "" } };
    expect((await scanAndBroadcast(db, deps(gold))).posted).toEqual(["XAUUSD BUY"]);
    // The alert's trade, as the tracker keeps it (message 1 in the channel).
    const trade: Row = {
      market: "XAUUSD",
      sender_worker: "trade",
      message_id: 1,
      status: "open",
      closed_at: null,
      // Recorded as the alert went out (the fake stamps posts with the real clock).
      created_at: new Date().toISOString(),
    };
    tables.trade_signals.push(trade);
    // Still running: no repeat.
    expect((await scanAndBroadcast(db, deps(gold, T0 + 5 * 60_000))).posted).toEqual([]);
    // Take profit hit ten minutes in: the next buy can go straight out.
    Object.assign(trade, { status: "tp3", closed_at: new Date(T0 + 10 * 60_000).toISOString() });
    expect((await scanAndBroadcast(db, deps(gold, T0 + 11 * 60_000))).posted).toEqual([
      "XAUUSD BUY",
    ]);
  });

  test("after a stop loss, the same side waits 15 minutes", async () => {
    const { db, tables } = fakeDb();
    const gold = { XAU: card("XAUUSD", "BUY", 90, 60), BTC: { reply: "" } };
    await scanAndBroadcast(db, deps(gold));
    tables.trade_signals.push({
      market: "XAUUSD",
      sender_worker: "trade",
      message_id: 1,
      status: "stopped",
      closed_at: new Date(T0 + 5 * 60_000).toISOString(),
      // Recorded as the alert went out (the fake stamps posts with the real clock).
      created_at: new Date().toISOString(),
    });
    expect((await scanAndBroadcast(db, deps(gold, T0 + 10 * 60_000))).posted).toEqual([]);
    expect((await scanAndBroadcast(db, deps(gold, T0 + 21 * 60_000))).posted).toEqual([
      "XAUUSD BUY",
    ]);
  });

  test("several trades run at once: a new setup goes out beside a running one", async () => {
    const { db, tables } = fakeDb();
    const at = (entry: number, direction: "BUY" | "SELL" = "BUY") => ({
      XAU: {
        ...card("XAUUSD", direction, 90, 120),
        plan: { ...card("XAUUSD", direction, 90, 120).plan, entry },
        summary: { stop: direction === "BUY" ? entry - 5 : entry + 5 },
      },
      BTC: { reply: "" },
    });
    const running = (message_id: number) =>
      tables.trade_signals.push({
        market: "XAUUSD",
        sender_worker: "trade",
        message_id,
        status: "open",
        closed_at: null,
        created_at: new Date().toISOString(),
      });
    expect((await scanAndBroadcast(db, deps(at(100) as never))).posted).toEqual(["XAUUSD BUY"]);
    running(1);
    // Five minutes on, a different buy: too soon after the running one.
    expect((await scanAndBroadcast(db, deps(at(110) as never, T0 + 5 * 60_000))).posted).toEqual(
      [],
    );
    // Twelve minutes on, the same setup found again (within half the risk): no.
    expect((await scanAndBroadcast(db, deps(at(102) as never, T0 + 12 * 60_000))).posted).toEqual(
      [],
    );
    // A new setup well away from the first: it runs alongside it.
    expect((await scanAndBroadcast(db, deps(at(110) as never, T0 + 12 * 60_000))).posted).toEqual([
      "XAUUSD BUY",
    ]);
    running(2);
    // A sell can run beside them too, and that's three: the most at once.
    expect(
      (await scanAndBroadcast(db, deps(at(120, "SELL") as never, T0 + 13 * 60_000))).posted,
    ).toEqual(["XAUUSD SELL"]);
    running(3);
    expect((await scanAndBroadcast(db, deps(at(130) as never, T0 + 30 * 60_000))).posted).toEqual(
      [],
    );
    // One of them hits its take profit: room for another.
    tables.trade_signals[0].status = "tp3";
    expect((await scanAndBroadcast(db, deps(at(130) as never, T0 + 31 * 60_000))).posted).toEqual([
      "XAUUSD BUY",
    ]);
  });

  test("without the table, nothing is posted (it can't tell repeats apart)", async () => {
    const { db } = fakeDb({ broken: true });
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: card("BTCUSD", "BUY", 90) });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
    expect(d.sent).toHaveLength(0);
  });

  test("a failed post isn't recorded, so the next scan tries again", async () => {
    const { db, rows } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: { reply: "" } });
    d.post = async () => null;
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  test("channel card wording", () => {
    expect(channelCard("x")).toBe("x");
    const card = [
      "🔴 I'm gonna sell ₿ BTC/USD now at 77397.70",
      "🛑 My stop loss will be 77496.66 · −$9.90",
      "🎯 I'll take profit at 77331.73 · +$6.60",
      "🔒 At 77351.52 (70% of the way) my stop moves to 77377.91, locking in profit",
      "",
      "⏱ 15M · 💪 70%",
      "🧩 Bear flag",
      "⚠️ News in 20 minutes",
      "💰 Test account balance: $1,000 · this trade 0.1 lot",
      "📏 Why 0.1: 70% sure",
    ].join("\n");
    expect(channelCard(card)).toBe(
      [
        "🔴 I'm gonna sell ₿ BTC/USD now at 77397.70",
        "🛑 My stop loss will be 77496.66 · −$9.90",
        "🎯 I'll take profit at 77331.73 · +$6.60",
        "⏱ 15M · 💪 70%",
      ].join("\n"),
    );
  });
});
