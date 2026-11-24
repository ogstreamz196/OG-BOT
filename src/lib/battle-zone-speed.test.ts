import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiTiming, fetchAiChat } from "./ai-endpoint.server";
import { groupRoomNote } from "./battle-prompts";

const realFetch = globalThis.fetch;
const ENV = { ...process.env };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$|^GEMINI_/.test(k)) delete process.env[k];
  }
  process.env.POLLINATIONS_NO_KEY = "off";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...ENV };
  aiTiming.freeHedgeMs = 3_000;
});

describe("Battle Zone clapbacks", () => {
  it("a slow swearing model doesn't hold the reply up: the fast free models race in", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    aiTiming.freeHedgeMs = 40;
    const hits: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/rest/v1/") || u.includes("/api/v1/models"))
        return new Response("{}", { status: 503 });
      const who = u.includes("openrouter") ? "openrouter" : u.includes("groq") ? "groq" : "other";
      hits.push(who);
      if (who === "openrouter") {
        // Hangs until it's called off.
        await new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "oi oi" } }] }));
    }) as typeof fetch;
    const t0 = Date.now();
    const { provider } = await fetchAiChat(
      { messages: [{ role: "user", content: "alright dickhead" }] },
      "u",
      { foulMouth: true, freeOnly: true },
    );
    expect(provider).toBe("groq");
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(hits[0]).toBe("openrouter");
    expect(hits).not.toContain("other");
    await sleep(5);
  });

  it("is a group room: names the crowd and tells OG B0T to work it", () => {
    const n = groupRoomNote("Dee", ["Dee", "Sam", "Kez", "Sam"]);
    expect(n).toMatch(/GROUP CUSS BATTLE/);
    expect(n).toMatch(/Sam, Kez/);
    expect(n).not.toMatch(/roast/i);
    expect(groupRoomNote("Dee", [])).toMatch(/help bury Dee/);
  });
});
