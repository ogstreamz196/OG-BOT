import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertBoss(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: string },
    ) => Promise<{ data: boolean | null }>;
  };
  const [admin, boss] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!admin.data && !boss.data) throw new Error("Forbidden");
}

const PROVIDERS = ["pollinations", "openrouter", "gemini"] as const;
type Provider = (typeof PROVIDERS)[number];
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Boss: the extra AI keys (provider, label, last four characters; never the key). */
export const listAiKeysFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const k = await import("./ai-keys.server");
    return k.listAiKeys();
  });

/** Boss: add a key. It's sealed on the server and never sent back. */
export const addAiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { provider: Provider; key: string; label: string | null } => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!PROVIDERS.includes(o.provider as Provider)) throw new Error("Pick a provider.");
    if (typeof o.key !== "string") throw new Error("Paste a key.");
    return {
      provider: o.provider as Provider,
      key: o.key,
      label: typeof o.label === "string" ? o.label : null,
    };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const k = await import("./ai-keys.server");
    await k.addAiKey(data.provider, data.key, data.label);
    return { ok: true };
  });

/** Boss: switch a key on or off, or remove it. */
export const updateAiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { id: string; action: "on" | "off" | "remove" } => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!isId(o.id) || !["on", "off", "remove"].includes(String(o.action)))
      throw new Error("Bad request");
    return { id: o.id, action: o.action as "on" | "off" | "remove" };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const k = await import("./ai-keys.server");
    if (data.action === "remove") await k.removeAiKey(data.id);
    else await k.setAiKey(data.id, { enabled: data.action === "on" });
    return { ok: true };
  });

const TEST_URL: Record<Provider, string> = {
  pollinations: "https://gen.pollinations.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};

/** Boss: try a stored key with a tiny request and save how it went. */
export const testAiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { id: string } => {
    const id = (d as { id?: unknown } | null)?.id;
    if (!isId(id)) throw new Error("Bad request");
    return { id };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const k = await import("./ai-keys.server");
    const { FOUL_CAPABLE_FREE_MODEL } = await import("./ai-endpoint.server");
    const found = await k.revealForTest(data.id);
    if (!found) return { status: "Couldn't read this key. Remove it and add it again." };
    const model =
      found.provider === "pollinations"
        ? "openai-fast"
        : found.provider === "openrouter"
          ? FOUL_CAPABLE_FREE_MODEL
          : process.env.GEMINI_FREE_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    let status: string;
    try {
      const res = await fetch(TEST_URL[found.provider], {
        method: "POST",
        headers: {
          Authorization: `Bearer ${found.key}`,
          "Content-Type": "application/json",
          ...(found.provider === "openrouter"
            ? { "HTTP-Referer": "https://ogbot.co.uk", "X-Title": "OG BOT" }
            : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply PONG" }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      status = res.ok
        ? "Working"
        : res.status === 401 || res.status === 403
          ? "Rejected: the key is wrong or switched off"
          : res.status === 429
            ? "Working, but at its limit right now"
            : `Not answering (HTTP ${res.status})`;
    } catch {
      status = "No answer";
    }
    await k.setAiKey(data.id, { last_status: status }).catch(() => undefined);
    return { status };
  });
