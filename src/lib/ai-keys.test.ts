import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanKey,
  forgetAiKeys,
  keyHint,
  listAiKeys,
  loadExtraKeys,
  openKey,
  sealKey,
} from "./ai-keys.server";
import { freeFallbackTargets } from "./ai-endpoint.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OG_HUB_SERVICE_KEY;
  forgetAiKeys();
});

describe("extra AI keys", () => {
  it("seals a key so only the same secret opens it", async () => {
    const sealed = await sealKey("sk-or-v1-abcdef1234567890", "hub-secret");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("abcdef");
    expect(await openKey(sealed, "hub-secret")).toBe("sk-or-v1-abcdef1234567890");
    expect(await openKey(sealed, "another-secret")).toBeNull();
  });

  it("tidies a pasted key and only shows its last four characters", () => {
    expect(cleanKey('  "Bearer sk-abc123456789xyz"  ')).toBe("sk-abc123456789xyz");
    expect(cleanKey("too short")).toBeNull();
    expect(cleanKey("has a space in it here")).toBeNull();
    expect(keyHint("sk-abc123456789xyz")).toBe("••••9xyz");
  });

  it("says it isn't connected without the hub secret, and changes nothing", async () => {
    expect(await listAiKeys()).toEqual({ rows: [], problem: "not_connected" });
    expect(await loadExtraKeys()).toEqual({ pollinations: [], openrouter: [], gemini: [] });
  });

  it("puts the Boss's keys first and keeps the old ones as the fallback", async () => {
    process.env.OG_HUB_SERVICE_KEY = "hub-secret";
    process.env.POLLINATIONS_API_KEY = "env-poll";
    const rows = [
      { provider: "gemini", key_enc: await sealKey("gem-free-key-123456", "hub-secret") },
      { provider: "pollinations", key_enc: await sealKey("poll-extra-key-123456", "hub-secret") },
      { provider: "openrouter", key_enc: await sealKey("or-extra-key-123456", "hub-secret") },
    ];
    const seen: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    await loadExtraKeys();
    // Read from og_bot with the hub key; never sent anywhere else.
    expect(seen[0]["Accept-Profile"]).toBe("og_bot");
    const auth = freeFallbackTargets().map((t) => t.headers.Authorization);
    expect(auth.slice(0, 3)).toEqual([
      "Bearer gem-free-key-123456",
      "Bearer poll-extra-key-123456",
      "Bearer or-extra-key-123456",
    ]);
    expect(auth).toContain("Bearer env-poll");
    // Foul mouth: the extra OpenRouter key before the old ones.
    expect(freeFallbackTargets(true)[0].headers.Authorization).toBe("Bearer or-extra-key-123456");
    delete process.env.POLLINATIONS_API_KEY;
  });

  it("keeps the old keys when the hub can't be reached", async () => {
    process.env.OG_HUB_SERVICE_KEY = "hub-secret";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await loadExtraKeys()).toEqual({ pollinations: [], openrouter: [], gemini: [] });
  });
});
