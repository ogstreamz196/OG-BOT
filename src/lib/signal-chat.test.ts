import { beforeEach, describe, expect, test, vi } from "vitest";

// The signals chat stays clutter free: a new alert clears that pair's older
// alert and updates, and today's score always sits at the bottom.

const calls: { method: string; body: Record<string, any> }[] = [];
let nextId = 500;
vi.mock("./telegram-worker.server", () => ({
  workerApi: async (method: string, body: Record<string, any>) => {
    calls.push({ method, body });
    if (method === "sendMessage") return { ok: true, result: { message_id: nextId++ } };
    if (method === "getChat")
      return body.chat_id === "@ogsignals"
        ? { ok: true, result: { id: -1009999 } }
        : { ok: false, description: "Bad Request: chat not found" };
    return { ok: true };
  },
}));

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};

/** A small in-memory stand-in for the database client. */
function fakeAdmin() {
  return {
    from(name: string) {
      const rows = (tables[name] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let action: "select" | "update" | "delete" = "select";
      let patch: Row = {};
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), q),
        update: (p: Row) => ((action = "update"), (patch = p), q),
        delete: () => ((action = "delete"), q),
        upsert: async (row: Row) => {
          rows.push({ created_at: new Date().toISOString(), ...row });
          return { error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (action === "update") hit.forEach((r) => Object.assign(r, patch));
          if (action === "delete") tables[name] = rows.filter((r) => !hit.includes(r));
          resolve({ data: hit, error: null });
        },
      };
      return q;
    },
  };
}

const CHAT = -1001234;
const deleted = () =>
  calls.filter((c) => c.method === "deleteMessages").flatMap((c) => c.body.message_ids);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables.signal_results = [];
  process.env.SIGNALS_CHANNEL_ID = String(CHAT);
  process.env.SIGNALS_BOT_TOKEN = "test";
});

describe("clearOlderPair", () => {
  test("a new gold alert clears the old gold alert and its updates, never bitcoin's", async () => {
    const { clearOlderPair } = await import("./signal-chat.server");
    tables.signal_chat_messages = [
      { chat_id: CHAT, message_id: 10, market: "XAUUSD", kind: "card" },
      { chat_id: CHAT, message_id: 11, market: "XAUUSD", kind: "update" },
      { chat_id: CHAT, message_id: 12, market: "BTCUSD", kind: "card" },
      { chat_id: CHAT, message_id: 13, market: null, kind: "score" },
      { chat_id: CHAT, message_id: 20, market: "XAUUSD", kind: "card" },
    ];
    tables.trade_signals = [
      { chat_id: CHAT, market: "XAUUSD", message_id: 10, created_at: new Date().toISOString() },
      { chat_id: CHAT, market: "BTCUSD", message_id: 12, created_at: new Date().toISOString() },
    ];
    await clearOlderPair(fakeAdmin(), CHAT, "XAUUSD", 20);
    expect(deleted().sort()).toEqual([10, 11]);
    expect(tables.signal_chat_messages.map((r) => r.message_id)).toEqual([12, 13, 20]);
    // The old gold signal stops messaging the chat; bitcoin's carries on.
    expect(tables.trade_signals.map((r) => r.chat_id)).toEqual([null, CHAT]);
  });
});

describe("refreshScore", () => {
  test("today's score goes to the bottom and only the newest one stays", async () => {
    const { refreshScore } = await import("./signal-chat.server");
    tables.signal_chat_messages = [{ chat_id: CHAT, message_id: 13, market: null, kind: "score" }];
    tables.signal_results = [
      {
        market: "XAUUSD",
        label: "XAU/USD",
        outcome: "win",
        pips: 30,
        unit: "pips",
        decided_at: new Date().toISOString(),
      },
    ];
    await refreshScore(fakeAdmin(), CHAT);
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.body.text).toBe("📊 TODAY'S SCORE · ✅ 1 won · 🛑 0 lost\n🟢 XAU/USD +30.0 pips");
    expect(sent.body.disable_notification).toBe(true);
    expect(deleted()).toEqual([13]);
    expect(tables.signal_chat_messages.filter((r) => r.kind === "score")).toHaveLength(1);
  });

  test("two refreshes at once still leave one scoreboard", async () => {
    const { refreshScore } = await import("./signal-chat.server");
    const admin = fakeAdmin();
    await Promise.all([refreshScore(admin, CHAT), refreshScore(admin, CHAT)]);
    expect(tables.signal_chat_messages.filter((r) => r.kind === "score")).toHaveLength(1);
  });
});

describe("rollScoreDay", () => {
  test("yesterday's score is replaced after UK midnight, today's is left alone", async () => {
    const { rollScoreDay } = await import("./signal-chat.server");
    const now = Date.parse("2026-10-27T00:00:30Z");
    tables.signal_chat_messages = [
      { chat_id: CHAT, message_id: 13, kind: "score", created_at: "2026-10-26T22:00:00Z" },
    ];
    await rollScoreDay(fakeAdmin(), now);
    expect(calls.find((c) => c.method === "sendMessage")?.body.text).toContain(
      "nothing closed yet",
    );
    calls.length = 0;
    await rollScoreDay(fakeAdmin(), now + 60_000);
    expect(calls).toHaveLength(0);
  });
});

describe("isSignalsChat", () => {
  test("matches the signals chat however its id was saved", async () => {
    const { isSignalsChat } = await import("./signal-chat.server");
    process.env.SIGNALS_CHANNEL_ID = "1234";
    expect(await isSignalsChat(-1001234)).toBe(true);
    expect(await isSignalsChat(42)).toBe(false);
    // Saved as an @name: the trade bot looks up the number.
    process.env.SIGNALS_CHANNEL_ID = "@ogsignals";
    expect(await isSignalsChat(-1009999)).toBe(true);
  });
});

describe("rollScoreDay says why", () => {
  test("posted, up to date, or the reason it couldn't", async () => {
    const { rollScoreDay } = await import("./signal-chat.server");
    expect(await rollScoreDay(fakeAdmin())).toBe("posted");
    expect(await rollScoreDay(fakeAdmin())).toBe("up to date");
    process.env.SIGNALS_CHANNEL_ID = "@nowhere";
    expect(await rollScoreDay(fakeAdmin())).toBe(
      "skipped: the trade bot can't find the signals chat",
    );
    delete process.env.SIGNALS_BOT_TOKEN;
    expect(await rollScoreDay(fakeAdmin())).toBe("skipped: signals bot or chat not set up");
  });
});
