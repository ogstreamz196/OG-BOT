import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanKey,
  forgetAiKeys,
  keyHint,
  listAiKeys,
  loadExtraKeys,
  openKey,
  replaceAiKey,
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

  it("replaces a key in place: sealed, switched on, test result cleared, never sent back", async () => {
    process.env.OG_HUB_SERVICE_KEY = "hub-secret";
    const sent: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { method?: string; body?: string }) => {
      sent.push({ url, method: init.method, body: JSON.parse(init.body ?? "{}") });
      return new Response(null, { status: 204 });
    });
    const id = "11111111-2222-3333-4444-555555555555";
    await replaceAiKey(id, '  "Bearer new-openrouter-key-987654"  ');
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].url).toContain(`ai_keys?id=eq.${id}`);
    expect(sent[0].body).toMatchObject({
      key_hint: "••••7654",
      enabled: true,
      last_status: null,
      last_checked_at: null,
    });
    // Stored sealed: the plain key never leaves the server.
    expect(JSON.stringify(sent[0].body)).not.toContain("new-openrouter-key");
    expect(await openKey(String(sent[0].body.key_enc), "hub-secret")).toBe(
      "new-openrouter-key-987654",
    );
    await expect(replaceAiKey(id, "short")).rejects.toThrow("doesn't look like a key");
  });
});

describe("hub's shared free keys", () => {
  const OWN = [
    "FREE_GROQ_API_KEY",
    "FREE_GROQ_API_KEY_2",
    "GROQ_API_KEY",
    "GROQ_BACKUP_API_KEY",
    "FREE_POLLINATIONS_API_KEY",
    "POLLINATIONS_API_KEY",
    "FREE_OPENROUTER_API_KEY",
    "OPENROUTER_API_KEY",
  ];
  const saved: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of OWN) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const clearOwn = () => {
    for (const k of OWN) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  };

  it("stand in only for providers with no key of their own", () => {
    clearOwn();
    process.env.OG_HUB_SERVICE_KEY = "sb_secret_hubkey123456";
    process.env.GROQ_API_KEY = "gsk_own_key_123456";
    const urls = freeFallbackTargets().map((t) => t.url);
    expect(urls.some((u) => u.startsWith("https://api.groq.com/"))).toBe(true);
    expect(urls.some((u) => u.includes("ogstreamz-ai?provider=groq"))).toBe(false);
    expect(urls.some((u) => u.includes("ogstreamz-ai?provider=pollinations"))).toBe(true);
    expect(urls.some((u) => u.includes("ogstreamz-ai?provider=openrouter"))).toBe(true);
    const hub = freeFallbackTargets().find((t) => t.url.includes("ogstreamz-ai"))!;
    expect(hub.headers.apikey).toBe("sb_secret_hubkey123456");
    expect(hub.headers.Authorization).toBeUndefined();
  });

  it("add nothing without the hub key", () => {
    clearOwn();
    expect(freeFallbackTargets().some((t) => t.url.includes("ogstreamz-ai"))).toBe(false);
  });
});
