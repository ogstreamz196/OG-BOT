import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { tradeBotSecret } from "./telegram-worker.server";

// The OG Trade Bot's own webhook: the golden rule (no Gaffer, no work) and
// keeping out of what OG B0T handles in groups.

const TOKEN = "worker-token";
const GROUP = -100777;
const groups: Record<number, { og_bot_present: boolean; active_workers: string[] }> = {};
const said: { method: string; body: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      let id = 0;
      const q = {
        select: () => q,
        eq: (_c: string, v: number) => ((id = v), q),
        maybeSingle: async () => ({ data: groups[id] ?? null, error: null }),
      };
      return q;
    },
  },
}));
vi.mock("@/lib/trade-signal-context.server", () => ({
  buildTradeSignal: async (t: string) => ({ reply: /signal|scalp/i.test(t) ? "📈 CARD" : "" }),
  bestMarketAsk: async (t: string) => `XAUUSD signal ${t}`,
  plainForTelegram: (t: string) => t,
}));
vi.mock("@/lib/og-persona.server", () => ({ buildSystemPrompt: () => "persona" }));
vi.mock("@/lib/ai-endpoint.server", () => ({
  fetchAiChat: async () => ({
    response: new Response(JSON.stringify({ choices: [{ message: { content: "AI REPLY" } }] })),
  }),
}));

beforeEach(() => {
  process.env.SIGNALS_BOT_TOKEN = TOKEN;
  said.length = 0;
  for (const k of Object.keys(groups)) delete groups[Number(k)];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = /\/bot[^/]+\/(\w+)$/.exec(String(url))![1];
    said.push({ method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SIGNALS_BOT_TOKEN;
});

async function post(update: Record<string, unknown>, secret = tradeBotSecret(TOKEN)) {
  const { Route } = await import("@/routes/api/public/trade-bot/webhook");
  const { POST } = (
    Route.options as unknown as {
      server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers;
  return POST({
    request: new Request("https://x/api/public/trade-bot/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    }),
  });
}
const inGroup = (text: string, extra: Record<string, unknown> = {}) =>
  post({
    message: {
      message_id: 50,
      text,
      chat: { id: GROUP, type: "supergroup" },
      from: { id: 1 },
      ...extra,
    },
  });
const toTradeBot = { reply_to_message: { from: { is_bot: true, username: "Og_tradebot" } } };
const texts = () => said.filter((s) => s.method === "sendMessage").map((s) => String(s.body.text));

describe("OG Trade Bot webhook", () => {
  test("refuses calls without its secret", async () => {
    expect((await post({}, "wrong")).status).toBe(401);
  });

  test("added to a group without OG B0T: says why and leaves", async () => {
    await post({
      my_chat_member: { chat: { id: GROUP, type: "group" }, new_chat_member: { status: "member" } },
    });
    expect(texts()).toEqual([
      "Oi, I only work here if the Gaffer (OG B0T) is in the room. Add OG B0T first or do one.",
    ]);
    expect(said.at(-1)!.method).toBe("leaveChat");
  });

  test("added to a group OG B0T runs: stays, quietly", async () => {
    groups[GROUP] = { og_bot_present: true, active_workers: ["trade"] };
    await post({
      my_chat_member: { chat: { id: GROUP, type: "group" }, new_chat_member: { status: "member" } },
    });
    expect(said).toHaveLength(0);
  });

  test("a message in a group OG B0T has left: says why and leaves", async () => {
    groups[GROUP] = { og_bot_present: false, active_workers: ["trade"] };
    await inGroup("anyone?", toTradeBot);
    expect(texts()[0]).toContain("Add OG B0T first");
    expect(said.at(-1)!.method).toBe("leaveChat");
  });

  test("in OG B0T's group: signal asks and insults are OG B0T's, so it stays out", async () => {
    groups[GROUP] = { og_bot_present: true, active_workers: ["trade"] };
    await inGroup("gold scalp signal", toTradeBot);
    await inGroup("you're a useless muppet", toTradeBot);
    await inGroup("just general chat"); // not to it
    expect(said).toHaveLength(0);
  });

  test("in OG B0T's group: answers someone talking to it, threaded, no @handles asked for", async () => {
    groups[GROUP] = { og_bot_present: true, active_workers: ["trade"] };
    await inGroup("what's the best session for gold?", toTradeBot);
    const reply = said.find((s) => s.method === "sendMessage")!;
    expect(reply.body.text).toBe("AI REPLY");
    expect((reply.body.reply_parameters as { message_id: number }).message_id).toBe(50);
  });

  test("switched off in that group by the Boss: silent", async () => {
    groups[GROUP] = { og_bot_present: true, active_workers: [] };
    await inGroup("what's the best session for gold?", toTradeBot);
    expect(said).toHaveLength(0);
  });

  test("private chat: still its own trading sidekick", async () => {
    await post({
      message: { message_id: 1, text: "btc scalp signal", chat: { id: 9, type: "private" } },
    });
    expect(texts()).toEqual(["📈 CARD"]);
  });
});
