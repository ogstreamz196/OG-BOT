import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ai-endpoint.server", () => ({
  freeFallbackTargets: () => [
    { url: "https://groq/a", headers: {}, model: "openai/gpt-oss-120b", provider: "groq" },
    { url: "https://groq/b", headers: {}, model: "qwen/qwen3.8-27b", provider: "groq" },
    { url: "https://or/c", headers: {}, model: "nvidia/nemotron", provider: "openrouter" },
    { url: "https://poll/d", headers: {}, model: "openai-fast", provider: "pollinations" },
  ],
}));

import { deskLines, parseJsonReply, runDesk } from "./signal-desk.server";

type Body = { model: string; messages: { role: string; content: string }[] };
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("parseJsonReply", () => {
  it("finds the JSON in a chatty or thinking reply", () => {
    expect(parseJsonReply('<think>hmm {"x":1}</think> Sure! {"lean":"BUY"} ok')).toEqual({
      lean: "BUY",
    });
    expect(parseJsonReply("no json here")).toBeNull();
  });
});

describe("runDesk", () => {
  it("gives each analyst its own job, shows wave 1 to wave 2, and the chief decides", async () => {
    const seen: Body[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as Body;
        seen.push(body);
        const sys = body.messages[0].content;
        if (sys.includes("chief"))
          return reply('{"direction":"SELL","call":"Sellers own it, mate."}');
        const lean = sys.includes("Trend analyst") ? "SELL" : "BUY";
        return reply(`{"lean":"${lean}","conviction":70,"finding":"${lean} because reasons."}`);
      }),
    );
    const d = (await runDesk("XAU/USD (Gold)", "LIVE MARKET DATA price 2400"))!;
    expect(d.direction).toBe("SELL");
    expect(d.findings.map((f) => f.role)).toEqual(["trend", "levels", "momentum", "risk"]);
    // Each role was asked by its own model first.
    const by = (role: string) =>
      seen.find((b) => b.messages[0].content.includes(`${role} analyst`))!;
    expect(by("Trend").model).toBe("openai/gpt-oss-120b");
    expect(by("Levels").model).toBe("qwen/qwen3.8-27b");
    expect(by("Momentum").model).toBe("nvidia/nemotron");
    expect(by("Risk").model).toBe("openai-fast");
    // Wave 2 sees wave 1's findings; the chief sees everyone's.
    expect(by("Momentum").messages[1].content).toContain("Trend analyst: SELL");
    expect(by("Trend").messages[1].content).not.toContain("THE DESK SO FAR");
    const chief = seen.find((b) => b.messages[0].content.includes("chief"))!;
    expect(chief.messages[1].content).toContain("Risk analyst: BUY");
    expect(deskLines(d).at(-1)).toBe("👑 Chief's call: SELL · Sellers own it, mate.");
  });

  it("falls back to the weighted vote when the chief doesn't answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const sys = (JSON.parse(init.body) as Body).messages[0].content;
        if (sys.includes("chief")) return new Response("busy", { status: 429 });
        return reply('{"lean":"BUY","conviction":60,"finding":"Up only."}');
      }),
    );
    expect((await runDesk("BTC/USD", "data"))!.direction).toBe("BUY");
  });

  it("gives up (null) when every model fails, so the engine's card is used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    expect(await runDesk("BTC/USD", "data")).toBeNull();
  });
});
