import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escapeTelegramHtml, telegramApi, telegramCall } from "./telegram-api.server";

const env = { ...process.env };
const realFetch = globalThis.fetch;
const realError = console.error;
let calls: [string, RequestInit][] = [];

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("telegramApi", () => {
  beforeEach(() => {
    calls = [];
    process.env.OG_BOT_TOKEN = "123:abc";
    console.error = () => {};
  });
  afterEach(() => {
    process.env = { ...env };
    globalThis.fetch = realFetch;
    console.error = realError;
  });

  it("calls the bot API directly when the bot token is set", async () => {
    mockFetch(200, { ok: true, result: { message_id: 7 } });
    const res = await telegramApi("sendMessage", { chat_id: 1, text: "hi" });
    expect(res).toEqual({ ok: true, result: { message_id: 7 } });
    expect(calls[0][0]).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(await telegramCall("sendMessage", { chat_id: 1 })).toEqual({ message_id: 7 });
  });

  it("uses the connector when there is no bot token", async () => {
    delete process.env.OG_BOT_TOKEN;
    process.env.TELEGRAM_API_KEY = "tg";
    process.env.LOVABLE_API_KEY = "lv";
    mockFetch(200, { ok: true, result: true });
    await telegramApi("deleteMessage", { chat_id: 1, message_id: 2 });
    expect(calls[0][0]).toBe("https://connector-gateway.lovable.dev/telegram/deleteMessage");
    expect((calls[0][1].headers as Record<string, string>)["X-Connection-Api-Key"]).toBe("tg");
  });

  it("keeps Telegram's reason on API errors", async () => {
    mockFetch(400, { ok: false, description: "Bad Request: message to forward not found" });
    const res = await telegramApi("forwardMessage", {});
    expect(res?.ok).toBe(false);
    expect(res?.description).toMatch(/not found/);
    expect(await telegramCall("forwardMessage", {})).toBeNull();
  });

  it("returns null when nothing is configured or the network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await telegramApi("getMe", {})).toBeNull();
    delete process.env.OG_BOT_TOKEN;
    delete process.env.TELEGRAM_API_KEY;
    expect(await telegramApi("getMe", {})).toBeNull();
  });

  it("escapes HTML", () => {
    expect(escapeTelegramHtml("<b>Tom & Jerry</b>")).toBe("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
  });
});
