import { beforeEach, describe, expect, test, vi } from "vitest";

// The signal watcher announcing fills and profit hits from the minute still
// forming, while anything touching a stop waits for the closed candle.

const MIN = 60_000;
const NOW = Date.parse("2026-10-27T12:00:40Z"); // 40s into the minute
const MINUTE_START = NOW - 40_000;

type Row = Record<string, unknown>;
const rows: Row[] = [];
const sent: string[] = [];
let candles: { t: number; o: number; h: number; l: number; c: number }[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      let patch: Row | null = null;
      let id: unknown;
      const q = {
        select: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        eq: (_c: string, v: unknown) => ((id = v), q),
        update: (p: Row) => ((patch = p), q),
        upsert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (patch) {
            Object.assign(rows.find((r) => r.id === id) ?? {}, patch);
            return resolve({ error: null });
          }
          resolve({
            data: rows.filter((r) => ["pending", "open", "tp1", "tp2"].includes(String(r.status))),
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
}));
vi.mock("./telegram-api.server", () => ({
  telegramCall: async (method: string, body: { text: string }) => {
    if (method === "sendMessage") sent.push(body.text);
    return { message_id: 1 };
  },
}));

const bar = (t: number, l: number, h: number) => ({ t, o: 100, h, l, c: (l + h) / 2 });

beforeEach(() => {
  sent.length = 0;
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
    expect(sent[0]).toContain("Stop Loss hit");
  });
});
