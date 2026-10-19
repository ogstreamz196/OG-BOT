import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiChat, getLiveResearchContext, liveFactsMessage } from "./ai-endpoint.server";

const realFetch = globalThis.fetch;
const ENV = { ...process.env };
/** Swaps in a fake fetch (works under both Vitest and Bun's test runner). */
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

const grounded = {
  candidates: [
    {
      content: { parts: [{ text: "- Arsenal 2-1 Chelsea (full time)" }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://x/1", title: "bbc.co.uk" } },
          { web: { uri: "https://x/2", title: "bbc.co.uk" } },
          { web: { uri: "https://x/3", title: "skysports.com" } },
        ],
      },
    },
  ],
};

describe("live search (Gemini + Google Search)", () => {
  it("needs no Perplexity key and returns nothing without Gemini", async () => {
    process.env.PERPLEXITY_API_KEY = "old";
    const spy = vi.fn();
    stubFetch(spy);
    expect(await getLiveResearchContext("who won today")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks Gemini with the Google Search tool and returns facts plus sources", async () => {
    process.env.GEMINI_API_KEY = "g";
    let sent: { url: string; body: any } | null = null;
    stubFetch(
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("generativelanguage")) {
          sent = { url, body: JSON.parse(String(init?.body)) };
          return new Response(JSON.stringify(grounded));
        }
        return new Response("{}");
      }),
    );
    const out = await getLiveResearchContext("who won the arsenal match today");
    expect(sent!.url).toContain(":generateContent?key=g");
    expect(sent!.body.tools).toEqual([{ googleSearch: {} }]);
    expect(sent!.body.contents[0].parts[0].text).toContain("who won the arsenal match today");
    expect(out).toBe("- Arsenal 2-1 Chelsea (full time)\n\nSources: bbc.co.uk, skysports.com");
  });

  it("soft-fails on an error so chat carries on", async () => {
    process.env.GEMINI_API_KEY = "g";
    stubFetch(vi.fn(async () => new Response("nope", { status: 429 })));
    expect(await getLiveResearchContext("latest news")).toBeNull();
    stubFetch(
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    expect(await getLiveResearchContext("latest news")).toBeNull();
  });

  it("keeps OG Bot in character when it presents the facts", () => {
    const msg = liveFactsMessage("- Arsenal 2-1 Chelsea", "who won?");
    expect(msg).toContain("CURRENT WEB SOURCES");
    expect(msg).toContain("normal OG Bot voice");
    expect(msg).toContain("who won?");
  });
});

describe("Foul Mouth chat routing", () => {
  it("drops to Gemini straight after the swearing model times out", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.OPENROUTER_BACKUP_API_KEY = "b";
    process.env.GEMINI_API_KEY = "g";
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        hits.push(url.includes("openrouter") ? "openrouter" : "gemini");
        if (url.includes("openrouter")) throw new DOMException("timed out", "TimeoutError");
        return new Response(JSON.stringify({ choices: [{ message: { content: "oi oi" } }] }));
      }),
    );
    const { provider } = await fetchAiChat(
      { messages: [{ role: "user", content: "alright dickhead" }] },
      "u",
      { foulMouth: true },
    );
    expect(provider).toBe("gemini");
    expect(hits).toEqual(["openrouter", "gemini"]);
  });

  it("still tries Groq first for ordinary chat", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        hits.push(url.includes("groq") ? "groq" : "other");
        return new Response(JSON.stringify({ choices: [{ message: { content: "yo" } }] }));
      }),
    );
    const { provider } = await fetchAiChat({ messages: [{ role: "user", content: "hey" }] });
    expect(provider).toBe("groq");
    expect(hits).toEqual(["groq"]);
  });
});

describe("when OG Bot searches the web", () => {
  it("searches for live facts, not small talk", async () => {
    const { needsLiveResearch } = await import("./ai-endpoint.server");
    for (const q of [
      "Who won the Premier League match today?",
      "what's the latest on the transfer window",
      "did arsenal win yesterday",
      "live score city game",
      "research: bitcoin ETF approval",
      "today's news",
    ])
      expect(needsLiveResearch(q), q).toBe(true);
    for (const q of ["how are you today", "you're a melt", "write me a diss track", "hello mate"])
      expect(needsLiveResearch(q), q).toBe(false);
  });
});
