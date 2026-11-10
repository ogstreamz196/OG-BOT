import { describe, expect, test, vi } from "vitest";

// The scan reads the Boss's last chat purge from the live database. These
// tests run on a pretend clock (October 2026), so a real purge time would
// make every pretend alert look older than it and break them (seen on
// Lovable's build machine, which has the database). No purge here.
vi.mock("./signal-chat.server", async (orig) => ({
  ...(await orig<object>()),
  chatPurgedAt: async () => null,
}));
import {
  BROADCAST_MIN_CONFIDENCE,
  MAX_RUNNING_PER_MARKET,
  CONCURRENCY_FREE,
  CONCURRENCY_BAR_MAX,
  concurrencyBar,
  channelCard,
  scanAndBroadcast,
  type ScanDeps,
} from "./signal-broadcast.server";

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
    build: async (ask) => signals[ask.startsWith("XAU") ? "XAU" : "BTC"] ?? { reply: "wait" },
    post: async (text) => (sent.push(text), sent.length),
    now: () => now,
  };
}

describe("auto-posted scalp signals", () => {
  test("trades from 70% confidence are posted, TOP only at 90%", async () => {
    for (const [direction, pct] of [
      ["BUY", 90],
      ["SELL", 70],
    ] as const) {
      const { db } = fakeDb();
      const d = deps({ BTC: card("BTCUSD", direction, pct) });
      const result = await scanAndBroadcast(db, d);
      expect(result).toEqual({ checked: 2, posted: [`BTCUSD ${direction}`] });
      expect(d.sent).toHaveLength(1);
      expect(d.sent[0]).toMatch(new RegExp(`^BTCUSD ${direction} card`));
      expect(d.sent[0]).toContain("THIS AIN'T FINANCIAL ADVICE");
    }
    expect(BROADCAST_MIN_CONFIDENCE).toBe(65);
  });

  test("scans both gold and bitcoin (gold is back)", async () => {
    const { db } = fakeDb();
    const asks: string[] = [];
    const d = deps({ BTC: card("BTCUSD", "BUY", 90) });
    const build = d.build;
    d.build = async (ask) => (asks.push(ask), build(ask));
    await scanAndBroadcast(db, d);
    expect(asks.some((a) => a.startsWith("XAUUSD"))).toBe(true);
    expect(asks.some((a) => a.startsWith("BTCUSD"))).toBe(true);
  });

  test("under 65% isn't posted", async () => {
    const { db } = fakeDb();
    const d = deps({ BTC: card("BTCUSD", "SELL", 64) });
    expect(await scanAndBroadcast(db, d)).toEqual({ checked: 2, posted: [] });
  });

  test("a 'wait' (no trade) is never posted", async () => {
    const { db } = fakeDb();
    const d = deps({ BTC: { reply: "wait card" } });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
  });

  test("successfully posted signals register the exact delivered message for follow-ups", async () => {
    const { db } = fakeDb();
    const d = deps({ BTC: card("BTCUSD", "BUY", 90) });
    const followed: number[] = [];
    d.follow = async (_signal, id) => {
      followed.push(id);
    };
    await scanAndBroadcast(db, d);
    expect(followed).toEqual([1]);
  });

  test("no repeats while a post is valid, unless it flips; posts again once it expires", async () => {
    const { db } = fakeDb();
    const btc = { BTC: card("BTCUSD", "BUY", 90, 60) };
    expect((await scanAndBroadcast(db, deps(btc))).posted).toEqual(["BTCUSD BUY"]);
    // A minute later, same call: not again.
    expect((await scanAndBroadcast(db, deps(btc, T0 + 60_000))).posted).toEqual([]);
    // It flips to a SELL: that's news, so it goes out.
    const flipped = { BTC: card("BTCUSD", "SELL", 90, 60) };
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 120_000))).posted).toEqual([
      "BTCUSD SELL",
    ]);
    // After the post's valid-until, a fresh one can go out.
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 61 * 60_000))).posted).toEqual([
      "BTCUSD SELL",
    ]);
  });

  test("the same side goes out again once the last alert's trade is over", async () => {
    const { db, tables } = fakeDb();
    const btc = { BTC: card("BTCUSD", "BUY", 90, 60) };
    expect((await scanAndBroadcast(db, deps(btc))).posted).toEqual(["BTCUSD BUY"]);
    // The alert's trade, as the tracker keeps it (message 1 in the channel).
    const trade: Row = {
      market: "BTCUSD",
      sender_worker: "trade",
      message_id: 1,
      status: "open",
      closed_at: null,
      // Recorded as the alert went out (the fake stamps posts with the real clock).
      created_at: new Date().toISOString(),
    };
    tables.trade_signals.push(trade);
    // One minute on, still running: too soon (90-second same-side gap), no repeat.
    expect((await scanAndBroadcast(db, deps(btc, T0 + 60_000))).posted).toEqual([]);
    // Take profit hit ten minutes in: the next buy can go straight out.
    Object.assign(trade, { status: "tp3", closed_at: new Date(T0 + 10 * 60_000).toISOString() });
    expect((await scanAndBroadcast(db, deps(btc, T0 + 11 * 60_000))).posted).toEqual([
      "BTCUSD BUY",
    ]);
  });

  test("after a stop loss, the same side waits 3 minutes", async () => {
    const { db, tables } = fakeDb();
    const btc = { BTC: card("BTCUSD", "BUY", 90, 60) };
    await scanAndBroadcast(db, deps(btc));
    tables.trade_signals.push({
      market: "BTCUSD",
      sender_worker: "trade",
      message_id: 1,
      status: "stopped",
      closed_at: new Date(T0 + 5 * 60_000).toISOString(),
      // Recorded as the alert went out (the fake stamps posts with the real clock).
      created_at: new Date().toISOString(),
    });
    // Two minutes after the stop (closed at T0+5): still sitting out.
    expect((await scanAndBroadcast(db, deps(btc, T0 + 7 * 60_000))).posted).toEqual([]);
    // Four minutes after the stop: the side can post again.
    expect((await scanAndBroadcast(db, deps(btc, T0 + 9 * 60_000))).posted).toEqual(["BTCUSD BUY"]);
  });

  test("several trades run at once, up to the cap, any direction", async () => {
    const { db, tables } = fakeDb();
    const at = (entry: number, direction: "BUY" | "SELL" = "BUY") => ({
      BTC: {
        ...card("BTCUSD", direction, 90, 120),
        plan: { ...card("BTCUSD", direction, 90, 120).plan, entry },
        summary: { stop: direction === "BUY" ? entry - 5 : entry + 5 },
      },
    });
    const running = (message_id: number) =>
      tables.trade_signals.push({
        market: "BTCUSD",
        sender_worker: "trade",
        message_id,
        status: "open",
        closed_at: null,
        created_at: new Date().toISOString(),
      });
    expect((await scanAndBroadcast(db, deps(at(100) as never))).posted).toEqual(["BTCUSD BUY"]);
    running(1);
    // One minute on, a different buy: too soon after the running one (90-second gap).
    expect((await scanAndBroadcast(db, deps(at(130) as never, T0 + 60_000))).posted).toEqual([]);
    // Four minutes on, the same setup found again (within 0.3 of the risk): no.
    expect((await scanAndBroadcast(db, deps(at(101) as never, T0 + 4 * 60_000))).posted).toEqual(
      [],
    );
    // A new setup well away from the first: it runs alongside it.
    expect((await scanAndBroadcast(db, deps(at(130) as never, T0 + 4 * 60_000))).posted).toEqual([
      "BTCUSD BUY",
    ]);
    running(2);
    // A sell can run beside them too (any direction).
    expect(
      (await scanAndBroadcast(db, deps(at(160, "SELL") as never, T0 + 5 * 60_000))).posted,
    ).toEqual(["BTCUSD SELL"]);
    running(3);
    // Fill up to the cap: up to MAX_RUNNING_PER_MARKET (10) at once.
    expect(MAX_RUNNING_PER_MARKET).toBe(10);
    let entry = 200;
    let mins = 10;
    for (let msg = 4; msg <= 10; msg++) {
      expect(
        (await scanAndBroadcast(db, deps(at(entry) as never, T0 + mins * 60_000))).posted,
      ).toEqual(["BTCUSD BUY"]);
      running(msg);
      entry += 20;
      mins += 4;
    }
    // Ten running: the most at once, so the next is held back.
    expect(
      (await scanAndBroadcast(db, deps(at(entry) as never, T0 + mins * 60_000))).posted,
    ).toEqual([]);
    // One of them hits its take profit: room for another.
    tables.trade_signals[0].status = "tp3";
    expect(
      (await scanAndBroadcast(db, deps(at(entry) as never, T0 + (mins + 1) * 60_000))).posted,
    ).toEqual(["BTCUSD BUY"]);
  });

  test("without the table, nothing is posted (it can't tell repeats apart)", async () => {
    const { db } = fakeDb({ broken: true });
    const d = deps({ BTC: card("BTCUSD", "BUY", 90) });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
    expect(d.sent).toHaveLength(0);
  });

  test("a failed post isn't recorded, so the next scan tries again", async () => {
    const { db, rows } = fakeDb();
    const d = deps({ BTC: card("BTCUSD", "BUY", 90) });
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
        "🛑 My stop loss will be 77496.66",
        "🎯 I'll take profit at 77331.73",
        "⏱ 15M · 💪 70%",
      ].join("\n"),
    );
  });
});

describe("concurrency-scaled confidence bar", () => {
  test("holds the base bar for the first few, then rises and caps", () => {
    // The first few carry no extra floor, so desk/random keep their lower bars.
    expect(concurrencyBar(0)).toBe(0);
    expect(concurrencyBar(CONCURRENCY_FREE)).toBe(0);
    expect(concurrencyBar(CONCURRENCY_FREE + 1)).toBe(BROADCAST_MIN_CONFIDENCE + 2);
    expect(concurrencyBar(50)).toBe(CONCURRENCY_BAR_MAX);
  });
});
