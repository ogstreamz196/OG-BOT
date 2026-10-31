import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiChat } from "./ai-endpoint.server";

const realFetch = globalThis.fetch;
const ENV = { ...process.env };
function stubFetch(fn: unknown) {
  globalThis.fetch = fn as typeof fetch;
}
beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$|^GEMINI_/.test(k)) delete process.env[k];
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...ENV };
});

describe("debug foul mouth routing", () => {
  it("logs every fetched url", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const urls: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("openrouter")) return new Response("rate limited", { status: 429 });
        return new Response(JSON.stringify({ choices: [{ message: { content: "oi oi" } }] }));
      }),
    );
    const { provider } = await fetchAiChat(
      { messages: [{ role: "user", content: "alright dickhead" }] },
      "u",
      { foulMouth: true, freeOnly: true },
    );
    console.log("PROVIDER:", provider);
    console.log("URLS:\n" + urls.join("\n"));
    await new Promise((r) => setTimeout(r, 500));
    console.log("URLS AFTER WAIT:\n" + urls.join("\n"));
    expect(true).toBe(true);
  });
});
