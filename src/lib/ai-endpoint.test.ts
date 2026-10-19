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

describe("smart routing", () => {
  it("sorts messages into banter, hard, or worth a quick check", async () => {
    const { messageTier } = await import("./ai-endpoint.server");
    expect(messageTier("oi you melt")).toBe("banter");
    expect(messageTier("lol")).toBe("banter");
    expect(messageTier("explain how compound interest works on a mortgage")).toBe("complex");
    expect(messageTier("can you help me sort out my CV for a warehouse job?")).toBe("unsure");
  });

  it("sends a message the router calls THINK to Gemini first", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (url.includes("groq") && body.max_tokens === 3) {
          hits.push("router");
          return new Response(JSON.stringify({ choices: [{ message: { content: "THINK" } }] }));
        }
        hits.push(url.includes("groq") ? "groq" : "gemini");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }),
    );
    const { provider } = await fetchAiChat(
      { messages: [{ role: "user", content: "should I pay off my car loan or save first?" }] },
      "u",
      { smart: true },
    );
    expect(provider).toBe("gemini");
    expect(hits).toEqual(["router", "gemini"]);
  });

  it("keeps banter on the free models with no router call, and falls back safely", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.max_tokens === 3) {
          hits.push("router");
          throw new Error("router down");
        }
        hits.push(url.includes("groq") ? "groq" : "gemini");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }),
    );
    await fetchAiChat({ messages: [{ role: "user", content: "oi dickhead" }] }, "u", {
      smart: true,
    });
    expect(hits).toEqual(["groq"]);
    hits.length = 0;
    await fetchAiChat(
      { messages: [{ role: "user", content: "what do you reckon about the new album?" }] },
      "u",
      { smart: true },
    );
    expect(hits).toEqual(["router", "groq"]);
  });

  it("never sends background memory jobs to the paid model first", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        hits.push(url.includes("groq") ? "groq" : "gemini");
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      }),
    );
    await fetchAiChat({ messages: [{ role: "user", content: "x".repeat(2000) }] }, "memory", {
      cheap: true,
    });
    expect(hits).toEqual(["groq"]);
  });
});
