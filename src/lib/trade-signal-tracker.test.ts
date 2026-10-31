import { beforeEach, describe, expect, test, vi } from "vitest";

// The signal watcher announcing fills and profit hits from the minute still
// forming, while anything touching a stop waits for the closed candle.

const MIN = 60_000;
const NOW = Date.parse("2026-10-27T12:00:40Z"); // 40s into the minute
const MINUTE_START = NOW - 40_000;

type Row = Record<string, unknown>;
const rows: Row[] = [];
const sent: string[] = [];
const edits: string[] = [];
const deletedMsgs: number[] = [];
const results: Row[] = [];
let candles: { t: number; o: number; h: number; l: number; c: number }[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "signal_results") {
        const r = {
          select: () => r,
          eq: () => r,
          maybeSingle: async () => ({ data: results[0] ?? null, error: null }),
          insert: async (row: Row) => (results.push(row), { error: null }),
          update: (p: Row) => (Object.assign(results[0], p), r),
        };
        return r;
      }
      let patch: Row | null = null;
      let id: unknown;
      const where: ((r: Row) => boolean)[] = [];
      let filtered = false;
      const q = {
        select: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        gte: () => q,
        eq: (c: string, v: unknown) => {
          if (c === "id") id = v;
          else filtered = true;
          where.push((r) => r[c] === v);
          return q;
        },
        neq: (c: string, v: unknown) => (where.push((r) => r[c] !== v), q),
        update: (p: Row) => ((patch = p), q),
        upsert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (patch) {
            Object.assign(rows.find((r) => r.id === id) ?? {}, patch);
            return resolve({ error: null });
          }
          // The watcher's own query (active rows), or a filtered lookup.
          resolve({
            data: filtered
              ? rows.filter((r) => where.every((f) => f(r)))
              : rows.filter((r) => ["pending", "open", "tp1", "tp2"].includes(String(r.status))),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock("./trade-signal-context.server", () => ({
  candles: async () => ({ data: candles }),
  higherTrend: async () => null,
  // No broker connected in these tests: mid-price hits, as before.
  BROKER_MARKETS: new Set<string>(),
  spotPrice: async () => NaN,
}));
vi.mock("./telegram-api.server", () => ({
  telegramCall: async (method: string, body: { text: string; message_ids?: number[] }) => {
    if (method === "sendMessage") sent.push(body.text);
    if (method === "editMessageText") edits.push(body.text);
    if (method === "deleteMessages") deletedMsgs.push(...(body.message_ids ?? []));
    return { message_id: 70 + sent.length };
  },
}));

const bar = (t: number, l: number, h: number) => ({ t, o: 100, h, l, c: (l + h) / 2 });

beforeEach(() => {
  sent.length = 0;
  edits.length = 0;
  deletedMsgs.length = 0;
  results.length = 0;
  rows.length = 0;
  rows.push({
    id: "s1",
    user_id: "u1",
    sender_worker: null,
    chat_id: 42,
    message_id: null,
    market: "BTCUSD",
    label: "BTC/USD",
    feeds: { binance: "BTCUSDT" },
    style: "scalp",
    timeframe: "5M",
    direction: "BUY",
    entry: 100,
    entry_type: "market",
    stop: 95,
    tp1: 104,
    tp2: 108,
    tp3: 112,
    decimals: 2,
    pip: null,
    card: null,
    status: "open",
    best_target: 0,
    entered_at: new Date(MINUTE_START - 5 * MIN).toISOString(),
    last_candle_at: null,
    last_price: null,
    last_edit_at: null,
    last_trend_check_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + 60 * MIN).toISOString(),
    created_at: new Date(MINUTE_START - 5 * MIN).toISOString(),
  });
});

describe("watchSignals: profit hits as they happen", () => {
  test("a target reached in the minute still forming is announced straight away", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    // Closed minutes go nowhere; the forming one has already traded above TP1.
    candles = [
      bar(MINUTE_START - 2 * MIN, 99, 101),
      bar(MINUTE_START - MIN, 99, 102),
      bar(MINUTE_START, 101, 105),
    ];
    const { events } = await watchSignals(NOW);
    expect(events).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Quick Scalp hit");
    expect(rows[0]).toMatchObject({ status: "tp1", best_target: 1 });
    // That minute is done with: when it closes it isn't judged (or announced) again.
    expect(rows[0].last_candle_at).toBe(new Date(MINUTE_START).toISOString());
    candles = [
      ...candles.slice(0, 2),
      bar(MINUTE_START, 101, 105.5),
      bar(MINUTE_START + MIN, 102, 103),
    ];
    await watchSignals(MINUTE_START + MIN + 5_000);
    expect(sent).toHaveLength(1);
  });

  test("a forming minute that also touched the stop waits for the close", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    candles = [bar(MINUTE_START - MIN, 99, 102), bar(MINUTE_START, 94, 105)];
    await watchSignals(NOW);
    expect(sent).toHaveLength(0);
    expect(rows[0].status).toBe("open");
    // Once it's closed, the usual rule decides (the stop counts first).
    await watchSignals(MINUTE_START + MIN + 5_000);
    expect(rows[0].status).toBe("stopped");
    expect(sent[0]).toContain("Stopped out");
  });
});

describe("watchSignals: one message per trade", () => {
  test("updates are written into the card as a journal, not sent as replies", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    Object.assign(rows[0], { card: "CARD", message_id: 9 });
    candles = [bar(MINUTE_START - MIN, 99, 102), bar(MINUTE_START, 101, 105)];
    await watchSignals(NOW);
    expect(sent).toHaveLength(0);
    expect(edits.at(-1)).toMatch(
      /^CARD\n\n\d\d:\d\d 🎯 Quick Scalp hit .+\n\n📍 .+ · Quick Scalp hit · \d\d:\d\d$/,
    );
    expect((rows[0].feeds as { log?: string[] }).log).toHaveLength(1);
    // The trade ends: the next line joins the journal and the live line goes.
    candles = [
      ...candles.slice(0, 1),
      bar(MINUTE_START, 101, 105),
      bar(MINUTE_START + MIN, 99, 103),
    ];
    candles.push(bar(MINUTE_START + 2 * MIN, 90, 99));
    await watchSignals(MINUTE_START + 3 * MIN + 5_000);
    expect(sent).toHaveLength(0);
    const last = edits.at(-1)!;
    // Only the latest update shows: each one replaces the one before.
    expect(last.split("\n").filter((l) => /^\d\d:\d\d /.test(l))).toHaveLength(1);
    expect(last).not.toContain("📍");
    expect((rows[0].feeds as { log?: string[] }).log).toHaveLength(2);
  });
});

describe("watchSignals: one take profit", () => {
  test("its hit is one update and the trade is done", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    Object.assign(rows[0], { tp1: 104, tp2: 104, tp3: 104 });
    candles = [bar(MINUTE_START - 2 * MIN, 99, 101), bar(MINUTE_START - MIN, 99, 105)];
    await watchSignals(NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Take profit hit (+4.00 points). Job done, I've banked it");
    expect(sent[0]).not.toMatch(/Little Brave|Greedy/);
    expect(rows[0]).toMatchObject({ status: "tp3", best_target: 3 });
  });
});

describe("watchSignals: the results book", () => {
  test("a target hit is booked as a win, in points to the furthest target", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    candles = [bar(MINUTE_START - 2 * MIN, 99, 101), bar(MINUTE_START - MIN, 99, 109)];
    await watchSignals(NOW);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      outcome: "win",
      best_target: 2,
      pips: 8,
      unit: "points",
      market: "BTCUSD",
    });
  });

  test("the stop loss first is booked as a loss", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    candles = [bar(MINUTE_START - MIN, 94, 101)];
    await watchSignals(NOW);
    expect(results[0]).toMatchObject({ outcome: "loss", pips: -5 });
  });

  test("running out of time posts nothing and books nothing", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    rows[0].expires_at = new Date(MINUTE_START - 30_000).toISOString();
    candles = [bar(MINUTE_START - MIN, 99, 101)];
    await watchSignals(NOW);
    expect(rows[0].status).toBe("expired");
    expect(sent).toHaveLength(0);
    expect(results).toHaveLength(0);
  });
});

describe("watchSignals: only one 'entry not reached' signal in a chat", () => {
  test("the older not-reached signal's card and notice go when a new one isn't reached", async () => {
    const { watchSignals } = await import("./trade-signal-tracker.server");
    // An older signal in the same chat that already wasn't reached.
    rows.push({
      ...rows[0],
      id: "old",
      status: "unfilled",
      message_id: 10,
      feeds: { binance: "BTCUSDT", notice: 11 },
    });
    // This one: a limit entry that never got there before time ran out.
    Object.assign(rows[0], {
      status: "pending",
      entry: 90,
      entered_at: null,
      message_id: 20,
      expires_at: new Date(MINUTE_START - 30_000).toISOString(),
    });
    candles = [bar(MINUTE_START - MIN, 99, 101)];
    await watchSignals(NOW);
    expect(rows[0].status).toBe("unfilled");
    expect(sent.at(-1)).toContain("Price never came to my entry");
    // The older one's card and notice are deleted; it stops messaging the chat.
    expect(deletedMsgs.sort()).toEqual([10, 11]);
    expect(rows.find((r) => r.id === "old")!.chat_id).toBeNull();
    // This one's notice is remembered, so the next one can replace it.
    expect((rows[0].feeds as { notice?: number }).notice).toBeGreaterThan(0);
  });
});

describe("liveOffset", () => {
  test("follows the live spot gap, keeping the original when the quote is missing or jumps", async () => {
    const { liveOffset } = await import("./trade-signal-tracker.server");
    expect(liveOffset(12, 2212.5, 2200)).toBeCloseTo(12.5, 9);
    expect(liveOffset(12, NaN, 2200)).toBe(12);
    // A 20-dollar jump in the gap (about 0.9%) is bad data.
    expect(liveOffset(12, 2232, 2200)).toBe(12);
  });
});

describe("journalCard", () => {
  const card = [
    "🟢 I'm gonna buy 🥇 XAU/USD at 2650.40 on a pullback",
    "🛑 My stop loss will be 2647.10 · −$165.00",
    "🎯 I'll take profit at 2652.90 · +$125.00",
    "",
    "⏱ 5M · 💪 72%",
  ].join("\n");
  test("says it will enter until it's in, then that it has", async () => {
    const { journalCard } = await import("./trade-signal-tracker.server");
    expect(journalCard(card, [], "📍 2651.00 · waiting for entry · 10:00")).toBe(
      `${card}\n\n📍 2651.00 · waiting for entry · 10:00`,
    );
    const inTrade = journalCard(
      card,
      ["10:05 ✅ I'm in at 2650.40"],
      "📍 2651.20 (+8 pips) · in the trade · 10:06",
      true,
    );
    expect(inTrade.split("\n").slice(0, 3)).toEqual([
      "🟢 I've bought 🥇 XAU/USD at 2650.40",
      "🛑 My stop loss is 2647.10 · −$165.00",
      "🎯 Taking profit at 2652.90 · +$125.00",
    ]);
    // Just the latest update, then the live line.
    expect(
      inTrade.endsWith(
        "\n\n10:05 ✅ I'm in at 2650.40\n\n📍 2651.20 (+8 pips) · in the trade · 10:06",
      ),
    ).toBe(true);
    // A breakout entry and a sell read the same way once in.
    expect(
      journalCard(
        "🔴 I'm gonna sell ₿ BTC/USD if it breaks below 79884.58\nx",
        [],
        null,
        true,
      ).split("\n")[0],
    ).toBe("🔴 I've sold ₿ BTC/USD at 79884.58");
  });
});
