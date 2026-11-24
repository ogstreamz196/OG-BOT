import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiTiming, fetchAiChat } from "./ai-endpoint.server";
<<<<<<< HEAD
import { groupRoomNote, houseClapback } from "./battle-prompts";
import { isProviderNotice } from "./ai-notice";
=======
import { groupRoomNote } from "./battle-prompts";
>>>>>>> 4ffa844c3d5b46d87bb5cf6e89564a3f0ca4a74a

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
<<<<<<< HEAD

  it("a provider's out-of-credits notice is never the reply: the next key answers", async () => {
    process.env.FREE_POLLINATIONS_API_KEY = "p1";
    process.env.FREE_POLLINATIONS_API_KEY_2 = "p2";
    let n = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/rest/v1/") || u.includes("/api/v1/models"))
        return new Response("{}", { status: 503 });
      n += 1;
      const content =
        n === 1
          ? "The account behind this API key doesn't have enough credits. Please [top up](<https://enter.pollinations.ai/top-up?ref=x>)"
          : "sit down, dickhead";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }) as typeof fetch;
    const { response } = await fetchAiChat({ messages: [{ role: "user", content: "oi" }] }, "u", {
      freeOnly: true,
    });
    const j = (await response.json()) as { choices: { message: { content: string } }[] };
    expect(j.choices[0].message.content).toBe("sit down, dickhead");

    // Only notices everywhere: an error to the caller, never the notice.
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/rest/v1/") || u.includes("/api/v1/models"))
        return new Response("{}", { status: 503 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Insufficient credits on this key" } }] }),
      );
    }) as typeof fetch;
    await expect(
      fetchAiChat({ messages: [{ role: "user", content: "oi" }] }, "u", { freeOnly: true }),
    ).rejects.toThrow();
  });

  it("Groq's other model still gets a go after one model is rate-limited", async () => {
    process.env.FREE_GROQ_API_KEY = "q";
    const models: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/rest/v1/") || u.includes("/api/v1/models"))
        return new Response("{}", { status: 503 });
      const m = JSON.parse(String(init?.body)).model as string;
      models.push(m);
      if (models.length === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "oi oi" } }] }));
    }) as typeof fetch;
    const { provider } = await fetchAiChat({ messages: [{ role: "user", content: "oi" }] }, "u", {
      freeOnly: true,
    });
    expect(provider).toBe("groq");
    expect(new Set(models).size).toBe(2);
  });

  it("spots provider notices, not cusses", () => {
    expect(isProviderNotice("The account behind this API key doesn't have enough credits.")).toBe(
      true,
    );
    expect(isProviderNotice("Rate limit exceeded, try later")).toBe(true);
    expect(isProviderNotice("Top up your bars before you come at me, you fucking muppet")).toBe(
      false,
    );
  });

  it("the no-AI clapback names them, cusses them, and never says roast", () => {
    const line = houseClapback("Dee", () => 0);
    expect(line).toMatch(/Dee/);
    expect(line).not.toMatch(/roast/i);
    expect(houseClapback("Dee", () => 0.99, true)).toMatch(/Dee/);
  });
=======
>>>>>>> 4ffa844c3d5b46d87bb5cf6e89564a3f0ca4a74a
});
