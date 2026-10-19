import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiTiming, fetchAiChat, streamAiChat } from "./ai-endpoint.server";
import { createLiveReply } from "./telegram-live-reply";

const realFetch = globalThis.fetch;
const ENV = { ...process.env };
function stubFetch(fn: unknown) {
  globalThis.fetch = fn as typeof fetch;
}
beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$|^GEMINI_/.test(k)) delete process.env[k];
  }
  aiTiming.foulHedgeMs = 5_000;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...ENV };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake OpenAI-style SSE stream that sends `parts` after `delayMs`. */
function sse(parts: string[], delayMs = 0, signal?: AbortSignal | null): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      await sleep(delayMs);
      if (signal?.aborted) return c.error(new Error("aborted"));
      for (const p of parts) {
        c.enqueue(
          enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`),
        );
        await sleep(2);
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("streaming replies", () => {
  it("streams words as they arrive and returns the full text", async () => {
    process.env.GROQ_API_KEY = "q";
    stubFetch(vi.fn(async () => sse(["oi ", "you ", "melt"])));
    const got: string[] = [];
    const { text, provider } = await streamAiChat(
      { messages: [{ role: "user", content: "alright" }] },
      "u",
      {},
      (d) => got.push(d),
    );
    expect(got).toEqual(["oi ", "you ", "melt"]);
    expect(text).toBe("oi you melt");
    expect(provider).toBe("groq");
  });

  it("moves to the next model when one fails before any words", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    stubFetch(
      vi.fn(async (url: string) =>
        url.includes("groq") ? new Response("busy", { status: 503 }) : sse(["sorted"]),
      ),
    );
    const { text, provider } = await streamAiChat(
      { messages: [{ role: "user", content: "hey" }] },
      "u",
      {},
      () => {},
    );
    expect(provider).toBe("gemini");
    expect(text).toBe("sorted");
  });

  it("Foul Mouth: a slow swearing model gets Gemini as backup, first words win", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GEMINI_API_KEY = "g";
    aiTiming.foulHedgeMs = 30;
    stubFetch(
      vi.fn(async (url: string, init?: RequestInit) =>
        url.includes("openrouter")
          ? sse(["too ", "slow"], 400, init?.signal)
          : sse(["you ", "melt"], 10),
      ),
    );
    const got: string[] = [];
    const { text, provider } = await streamAiChat(
      { messages: [{ role: "user", content: "oi" }] },
      "u",
      { foulMouth: true },
      (d) => got.push(d),
    );
    expect(provider).toBe("gemini");
    expect(text).toBe("you melt");
    expect(got.join("")).toBe("you melt");
  });

  it("Foul Mouth: a quick swearing model never wakes the backup", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GEMINI_API_KEY = "g";
    aiTiming.foulHedgeMs = 200;
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        hits.push(url.includes("openrouter") ? "openrouter" : "gemini");
        return sse(["oi ", "dickhead"]);
      }),
    );
    const { provider } = await streamAiChat(
      { messages: [{ role: "user", content: "oi" }] },
      "u",
      { foulMouth: true },
      () => {},
    );
    expect(provider).toBe("openrouter");
    expect(hits).toEqual(["openrouter"]);
  });
});

describe("Foul Mouth backup (no streaming, e.g. Battle Zone)", () => {
  const json = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }));

  it("uses Gemini when the swearing model is slow", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GEMINI_API_KEY = "g";
    aiTiming.foulHedgeMs = 30;
    stubFetch(
      vi.fn(async (url: string) => {
        if (url.includes("openrouter")) {
          await sleep(400);
          return json("too slow");
        }
        return json("you melt");
      }),
    );
    const started = Date.now();
    const { provider, response } = await fetchAiChat(
      { messages: [{ role: "user", content: "oi" }] },
      "u",
      { foulMouth: true },
    );
    expect(provider).toBe("gemini");
    expect((await response.json()).choices[0].message.content).toBe("you melt");
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("keeps the swearing model when it answers in time", async () => {
    process.env.OPENROUTER_API_KEY = "a";
    process.env.GEMINI_API_KEY = "g";
    aiTiming.foulHedgeMs = 200;
    const hits: string[] = [];
    stubFetch(
      vi.fn(async (url: string) => {
        hits.push(url.includes("openrouter") ? "openrouter" : "gemini");
        return json("oi dickhead");
      }),
    );
    const { provider } = await fetchAiChat({ messages: [{ role: "user", content: "oi" }] }, "u", {
      foulMouth: true,
    });
    expect(provider).toBe("openrouter");
    expect(hits).toEqual(["openrouter"]);
  });
});

describe("Telegram live reply", () => {
  function fakeIo() {
    const log: string[] = [];
    let n = 0;
    return {
      log,
      io: {
        send: async (text: string) => {
          log.push(`send:${text}`);
          return { result: { message_id: ++n } };
        },
        edit: async (id: number, text: string) => {
          log.push(`edit${id}:${text}`);
          return {};
        },
      },
    };
  }

  it("sends the first words at once, edits as it grows, then shows the final text", async () => {
    const { log, io } = fakeIo();
    const live = createLiveReply(io, 40);
    live.push("Oi ");
    await sleep(10);
    expect(log).toEqual(["send:Oi "]);
    live.push("you ");
    live.push("melt");
    await sleep(80);
    expect(log).toEqual(["send:Oi ", "edit1:Oi you melt"]);
    const sent = await live.finish("Oi you melt, innit");
    expect(log.at(-1)).toBe("edit1:Oi you melt, innit");
    expect(sent).toHaveLength(1);
  });

  it("sends overflow past Telegram's limit as extra messages", async () => {
    const { log, io } = fakeIo();
    const live = createLiveReply(io, 10);
    live.push("a".repeat(100));
    await sleep(20);
    const sent = await live.finish("b".repeat(4000));
    expect(sent).toHaveLength(2);
    expect(log.at(-1)).toBe(`send:${"b".repeat(200)}`);
  });

  it("does nothing live when no words arrived, so the caller sends normally", async () => {
    const { log, io } = fakeIo();
    const live = createLiveReply(io, 10);
    expect(await live.finish("hello")).toEqual([]);
    expect(log).toEqual([]);
  });
});
