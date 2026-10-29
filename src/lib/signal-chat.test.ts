import { beforeEach, describe, expect, test, vi } from "vitest";

// The signals chat stays clutter free: a new alert clears that pair's older
// alert and updates, and the OG Trade Bot's results always sit at the bottom.

const calls: { method: string; body: Record<string, any>; bot?: string }[] = [];
let nextId = 500;
let ogCanPost = true;
// OG B0T's own sender: it announces the trade bot's results.
vi.mock("./telegram-api.server", () => ({
  telegramApi: async (method: string, body: Record<string, any>) => {
    calls.push({ method, body, bot: "og" });
    if (method === "sendMessage")
      return ogCanPost
        ? { ok: true, result: { message_id: nextId++ } }
        : { ok: false, description: "Forbidden: bot is not a member of the channel chat" };
    return { ok: true };
  },
}));
vi.mock("./telegram-worker.server", () => ({
  workerApi: async (method: string, body: Record<string, any>) => {
    calls.push({ method, body, bot: "trade" });
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
        range: () => q,
        maybeSingle: async () => ({
          data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null,
          error: null,
        }),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), q),
        // Only `.not(col, "in", "(a,b)")` is used.
        not: (c: string, _op: string, list: string) => {
          const vals = list.replace(/[()]/g, "").split(",");
          filters.push((r) => !vals.includes(r[c]));
          return q;
        },
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
// Each message once, though both bots may be asked to remove it.
const deleted = () => [
  ...new Set(calls.filter((c) => c.method === "deleteMessages").flatMap((c) => c.body.message_ids)),
];

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
      {
        chat_id: CHAT,
        market: "XAUUSD",
        message_id: 10,
        status: "closed",
        created_at: new Date().toISOString(),
      },
      {
        chat_id: CHAT,
        market: "BTCUSD",
        message_id: 12,
        status: "open",
        created_at: new Date().toISOString(),
      },
    ];
    await clearOlderPair(fakeAdmin(), CHAT, "XAUUSD", 20);
    expect(deleted().sort()).toEqual([10, 11]);
    expect(tables.signal_chat_messages.map((r) => r.message_id)).toEqual([12, 13, 20]);
    // The old gold signal stops messaging the chat; bitcoin's carries on.
    expect(tables.trade_signals.map((r) => r.chat_id)).toEqual([null, CHAT]);
  });

  test("an older gold alert that's still running stays, with its updates", async () => {
    const { clearOlderPair } = await import("./signal-chat.server");
    tables.signal_chat_messages = [
      { chat_id: CHAT, message_id: 5, market: "XAUUSD", kind: "card" },
      { chat_id: CHAT, message_id: 6, market: "XAUUSD", kind: "update" },
      { chat_id: CHAT, message_id: 10, market: "XAUUSD", kind: "card" },
      { chat_id: CHAT, message_id: 11, market: "XAUUSD", kind: "update" },
      { chat_id: CHAT, message_id: 14, market: "XAUUSD", kind: "card" },
      { chat_id: CHAT, message_id: 20, market: "XAUUSD", kind: "card" },
    ];
    const at = new Date().toISOString();
    tables.trade_signals = [
      { chat_id: CHAT, market: "XAUUSD", message_id: 5, status: "expired", created_at: at },
      { chat_id: CHAT, market: "XAUUSD", message_id: 10, status: "tp1", created_at: at },
      { chat_id: CHAT, market: "XAUUSD", message_id: 14, status: "stopped", created_at: at },
    ];
    await clearOlderPair(fakeAdmin(), CHAT, "XAUUSD", 20);
    // Finished cards (and updates older than the one still running) go.
    expect(deleted().sort((a, b) => a - b)).toEqual([5, 6, 14]);
    expect(tables.signal_chat_messages.map((r) => r.message_id)).toEqual([10, 11, 20]);
    // The running one keeps messaging the chat.
    expect(tables.trade_signals.map((r) => r.chat_id)).toEqual([null, CHAT, null]);
  });
});

describe("refreshScore", () => {
  test("OG B0T announces the trade bot's results at the bottom, no daily score", async () => {
    const { refreshScore } = await import("./signal-chat.server");
    tables.signal_chat_messages = [{ chat_id: CHAT, message_id: 13, market: null, kind: "score" }];
    ogCanPost = true;
    expect(await refreshScore(fakeAdmin(), CHAT)).toBe("posted");
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.bot).toBe("og");
    expect(sent.body.text).toMatch(/^📣 OG TRADE BOT RESULTS/);
    expect(sent.body.text).not.toMatch(/TODAY|70%/);
    expect(sent.body.disable_notification).toBe(true);
    // The old post goes, whichever bot sent it.
    expect(deleted()).toEqual([13]);
    expect(tables.signal_chat_messages.filter((r) => r.kind === "score")).toHaveLength(1);
  });

  test("the trade bot posts them when OG B0T can't post there", async () => {
    const { refreshScore } = await import("./signal-chat.server");
    ogCanPost = false;
    expect(await refreshScore(fakeAdmin(), CHAT)).toBe("posted");
    ogCanPost = true;
    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends.map((c) => c.bot)).toEqual(["og", "trade"]);
  });

  test("two refreshes at once still leave one results post", async () => {
    const { refreshScore } = await import("./signal-chat.server");
    const admin = fakeAdmin();
    await Promise.all([refreshScore(admin, CHAT), refreshScore(admin, CHAT)]);
    expect(tables.signal_chat_messages.filter((r) => r.kind === "score")).toHaveLength(1);
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
