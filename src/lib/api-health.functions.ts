import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Connector } from "@/lib/connectors.server";
import { envKey } from "@/lib/key-names";

/**
 * Automated backend health check.
 *
 * Verifies every API key the generation + bot pipeline depends on
 * (AI providers, Suno, Stripe, Ledgerly, Telegram, Google, OG_BOT_*) by actually calling the provider where
 * a cheap probe exists, and returns actionable remediation for each failure.
 */

export type HealthGroup =
  | "AI chat & lyrics"
  | "Music"
  | "Payments"
  | "Telegram"
  | "Google"
  | "Bot hosting"
  | "Core";

export type HealthStatus = "ok" | "missing" | "invalid" | "unreachable" | "degraded";

export type HealthCheck = {
  key: string;
  label: string;
  group: HealthGroup;
  /** Secret name to rotate via the secure form. */
  secret?: string;
  help?: string;
  required: boolean;
  status: HealthStatus;
  detail: string;
  fix?: string;
  latencyMs?: number;
};

export type HealthReport = {
  checkedAt: string;
  healthy: boolean;
  okCount: number;
  failCount: number;
  checks: HealthCheck[];
};

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: "admin" },
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const SECRETS_FIX = "Open Project Settings → Secrets and set this value, then re-run the check.";

function missing(
  name: string,
  extra?: string,
): Omit<HealthCheck, "key" | "label" | "group" | "required"> {
  return {
    status: "missing",
    detail: `${name} is not set — every call that needs it fails immediately.`,
    fix: extra ?? SECRETS_FIX,
  };
}

async function timed<T>(fn: () => Promise<T>) {
  const t0 = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - t0 };
}

type Partial_ = Omit<HealthCheck, "key" | "label" | "group" | "required">;

/**
 * The hub's shared free keys (ogstreamz-ai ?check=1: only how many keys each
 * provider has and whether each was accepted, never a key).
 */
async function checkHubFreeKeys(): Promise<Partial_> {
  if (!process.env.OG_HUB_SERVICE_KEY) return missing("OG_HUB_SERVICE_KEY");
  const base = (process.env.OG_HUB_URL || "https://zqwngcndkxgxuwqyxihi.supabase.co").replace(/\/+$/, "");
  try {
    const { result, latencyMs } = await timed(() =>
      fetch(`${base}/functions/v1/ogstreamz-ai?check=1`, { signal: AbortSignal.timeout(15_000) }),
    );
    if (!result.ok)
      return { status: "unreachable", detail: `The hub answered HTTP ${result.status}.`, latencyMs };
    const { keys } = (await result.json()) as { keys?: Record<string, number[]> };
    const parts = Object.entries(keys ?? {}).map(
      ([p, list]) => `${p} ${list.filter((c) => c === 200).length}/${list.length}`,
    );
    const bad = Object.values(keys ?? {}).some((list) => list.some((c) => c !== 200));
    return {
      status: bad ? "degraded" : "ok",
      detail: `Keys working: ${parts.join(", ") || "none"}. Used when a provider has no key of its own here.`,
      fix: bad ? "Replace the rejected FREE_* key in the hub's Edge Function secrets." : undefined,
      latencyMs,
    };
  } catch {
    return { status: "unreachable", detail: "The hub didn't answer." };
  }
}

async function checkGemini(): Promise<Partial_> {
  const key = envKey("PAID_GEMINI_F196");
  if (!key) return missing("PAID_GEMINI_F196");
  try {
    const { result, latencyMs } = await timed(() =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`),
    );
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      return {
        status: "invalid",
        detail: `Gemini rejected the key (HTTP ${result.status}).`,
        fix: "Generate a fresh key in Google AI Studio and update PAID_GEMINI_F196 in Secrets.",
        latencyMs,
      };
    }
    if (!result.ok) {
      return {
        status: "unreachable",
        detail: `Gemini API returned HTTP ${result.status}.`,
        fix: "Transient Google outage or quota block — retry, then check quota in Google AI Studio.",
        latencyMs,
      };
    }
    const body = (await result.json().catch(() => ({}))) as { models?: unknown[] };
    return {
      status: "ok",
      detail: `Key valid · ${body.models?.length ?? 0} models available.`,
      latencyMs,
    };
  } catch (e) {
    return {
      status: "unreachable",
      detail: `Could not reach Gemini: ${e instanceof Error ? e.message : "network error"}`,
      fix: "Retry in a moment; if it persists Google's API is down.",
    };
  }
}


async function checkSuno(): Promise<Partial_> {
  const key = process.env["SUNO_API_KEY"];
  if (!key) return missing("SUNO_API_KEY");
  try {
    const { result, latencyMs } = await timed(() =>
      fetch("https://apibox.erweima.ai/api/v1/generate/credit", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const text = await result.text().catch(() => "");
    if (result.status === 401 || result.status === 403) {
      return {
        status: "invalid",
        detail: `Suno rejected the key (HTTP ${result.status}).`,
        fix: "Re-copy the API key from your Suno provider dashboard into SUNO_API_KEY.",
        latencyMs,
      };
    }
    if (!result.ok) {
      return {
        status: "unreachable",
        detail: `Suno API returned HTTP ${result.status}: ${text.slice(0, 120)}`,
        fix: "Song generation will fail until Suno responds — retry shortly.",
        latencyMs,
      };
    }
    let credits: number | null = null;
    try {
      const parsed = JSON.parse(text) as { data?: number | { credit?: number } };
      credits =
        typeof parsed.data === "number"
          ? parsed.data
          : typeof parsed.data?.credit === "number"
            ? parsed.data.credit
            : null;
    } catch {
      /* non-JSON body is still a 200 */
    }
    if (credits !== null && credits <= 0) {
      return {
        status: "degraded",
        detail: "Key valid but the Suno account has 0 credits left.",
        fix: "Top up credits with your Suno provider — generations will fail at 0.",
        latencyMs,
      };
    }
    return {
      status: "ok",
      detail: credits === null ? "Key valid." : `Key valid · ${credits} credits left.`,
      latencyMs,
    };
  } catch (e) {
    return {
      status: "unreachable",
      detail: `Could not reach Suno: ${e instanceof Error ? e.message : "network error"}`,
      fix: "Retry shortly — the Suno API host may be down.",
    };
  }
}

async function checkOgBotToken(): Promise<Partial_> {
  const token = process.env["OG_BOT_TOKEN"];
  if (!token) {
    return missing(
      "OG_BOT_TOKEN",
      "Get the token from @BotFather (/mybots → API token) and save it as OG_BOT_TOKEN.",
    );
  }
  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    return {
      status: "invalid",
      detail: "OG_BOT_TOKEN is not in BotFather format (123456:ABC…).",
      fix: "Re-copy the whole token from @BotFather — no spaces, no quotes.",
    };
  }
  try {
    const { result, latencyMs } = await timed(() =>
      fetch(`https://api.telegram.org/bot${token}/getMe`),
    );
    const body = (await result.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };
    if (!result.ok || body.ok === false) {
      return {
        status: "invalid",
        detail: `Telegram rejected the bot token: ${body.description ?? `HTTP ${result.status}`}`,
        fix: "The token was revoked or regenerated — get a fresh one from @BotFather.",
        latencyMs,
      };
    }
    return { status: "ok", detail: `Live bot @${body.result?.username ?? "unknown"}.`, latencyMs };
  } catch (e) {
    return {
      status: "unreachable",
      detail: `Could not reach Telegram: ${e instanceof Error ? e.message : "network error"}`,
      fix: "Retry shortly — api.telegram.org was not reachable.",
    };
  }
}

async function checkUrlSecret(name: string, label: string): Promise<Partial_> {
  const raw = process.env[name];
  if (!raw) return missing(name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      status: "invalid",
      detail: `${name} is not a valid URL ("${raw.slice(0, 40)}").`,
      fix: `Set ${name} to a full https:// URL.`,
    };
  }
  try {
    const { result, latencyMs } = await timed(() =>
      fetch(url.toString(), { method: "GET", redirect: "follow" }),
    );
    if (result.status >= 500) {
      return {
        status: "unreachable",
        detail: `${label} responded HTTP ${result.status}.`,
        fix: `${label} is up but erroring — check its own logs.`,
        latencyMs,
      };
    }
    return { status: "ok", detail: `Reachable (HTTP ${result.status}).`, latencyMs };
  } catch (e) {
    return {
      status: "unreachable",
      detail: `${label} did not respond: ${e instanceof Error ? e.message : "network error"}`,
      fix: `Confirm ${name} points at a running host.`,
    };
  }
}

function checkMintSecret(): Partial_ {
  const secret = process.env["OG_BOT_REMOTE_MINT_SECRET"];
  if (!secret) return missing("OG_BOT_REMOTE_MINT_SECRET");
  if (secret.length < 24) {
    return {
      status: "invalid",
      detail: `OG_BOT_REMOTE_MINT_SECRET is only ${secret.length} characters — too weak for HMAC signing.`,
      fix: "Replace it with a random 32+ character value (and update the remote bot to match).",
    };
  }
  return { status: "ok", detail: "Signing secret present and long enough." };
}

async function checkLovable(): Promise<Partial_> {
  if (process.env["LOVABLE_API_KEY"])
    return { status: "ok", detail: "Connected-service gateway key present; not used for AI." };
  // Not needed once Telegram, Drive, Sheets and Stripe all have their own keys.
  const { usesOwnKey } = await import("@/lib/connectors.server");
  const all = (["telegram", "google_drive", "google_sheets", "stripe"] as const).every(usesOwnKey);
  return all
    ? { status: "ok", detail: "Not needed: every connected service uses its own key." }
    : missing("LOVABLE_API_KEY", "Reconnect the affected payment or service connection.");
}

/** Tiny 1-token chat completion — proves the key works without real cost. */
async function checkChatKey(env: string, url: string, model: string, extra: Record<string, string> = {}): Promise<Partial_> {
  const key = envKey(env);
  if (!key) return missing(env);
  try {
    const { result, latencyMs } = await timed(() =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Reply PONG" }] }),
        signal: AbortSignal.timeout(15_000),
      }),
    );
    if (result.status === 401 || result.status === 403)
      return { status: "invalid", detail: `Key rejected (HTTP ${result.status}).`, fix: `Replace ${env} with a fresh key.`, latencyMs };
    if (result.status === 429)
      return { status: "degraded", detail: "Key valid but rate-limited or out of credit (HTTP 429).", fix: "Wait for the limit to reset or top up.", latencyMs };
    if (!result.ok) {
      const text = await result.text().catch(() => "");
      return { status: "unreachable", detail: `HTTP ${result.status}: ${text.slice(0, 120)}`, fix: "Retry shortly.", latencyMs };
    }
    return { status: "ok", detail: `Answered · model ${model}.`, latencyMs };
  } catch (e) {
    return { status: "unreachable", detail: `No response: ${e instanceof Error ? e.message : "network error"}`, fix: "Retry shortly." };
  }
}

/** Pollinations' open endpoint answers without any key (the router's last free resort). */
async function checkPollinationsNoKey(): Promise<Partial_> {
  try {
    const { result, latencyMs } = await timed(() =>
      fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai", messages: [{ role: "user", content: "Reply PONG" }] }),
        signal: AbortSignal.timeout(20_000),
      }),
    );
    if (result.status === 429)
      return { status: "degraded", detail: "Answering, but busy right now (HTTP 429).", fix: "It's shared and free; try again shortly.", latencyMs };
    if (!result.ok)
      return { status: "unreachable", detail: `HTTP ${result.status}. The open endpoint may need a key now.`, fix: "Add a free Pollinations key in the API vault above.", latencyMs };
    const j = (await result.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content ?? "").trim()
      ? { status: "ok", detail: "Answered with no key.", latencyMs }
      : { status: "degraded", detail: "Answered with an empty reply.", latencyMs };
  } catch (e) {
    return { status: "unreachable", detail: `No response: ${e instanceof Error ? e.message : "network error"}`, fix: "Retry shortly." };
  }
}

async function checkStripe(): Promise<Partial_> {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return missing("STRIPE_SECRET_KEY");
  try {
    const { result, latencyMs } = await timed(() =>
      fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } }),
    );
    if (result.status === 401) return { status: "invalid", detail: "Stripe rejected the key.", fix: "Replace STRIPE_SECRET_KEY.", latencyMs };
    if (!result.ok) return { status: "unreachable", detail: `Stripe HTTP ${result.status}.`, latencyMs };
    const b = (await result.json().catch(() => ({}))) as { livemode?: boolean };
    return { status: "ok", detail: `Key valid · ${b.livemode ? "live" : "test"} mode.`, latencyMs };
  } catch (e) {
    return { status: "unreachable", detail: `Could not reach Stripe: ${e instanceof Error ? e.message : "network error"}` };
  }
}

async function checkGateway(env: string, base: string, path: string, label: string): Promise<Partial_> {
  // Own key (connectors.server.ts) first; otherwise Lovable's gateway.
  const { connectorFetch, usesOwnKey } = await import("@/lib/connectors.server");
  const c = base as Connector;
  const own = usesOwnKey(c);
  if (!own) {
    if (!process.env[env]) return missing(env, `Reconnect ${label} in Connectors, or set its own key.`);
    if (!process.env["LOVABLE_API_KEY"]) return missing("LOVABLE_API_KEY");
  }
  const via = own ? "own key" : "gateway";
  try {
    const { result, latencyMs } = await timed(() =>
      connectorFetch(`https://connector-gateway.lovable.dev/${base}${path}`, {}, env),
    );
    if (result.status === 401 || result.status === 403)
      return { status: "invalid", detail: `${label} rejected (HTTP ${result.status}, ${via}).`, fix: own ? `Check ${label}'s own key.` : `Reconnect ${label}.`, latencyMs };
    if (result.status >= 500) return { status: "unreachable", detail: `${label} HTTP ${result.status} (${via}).`, latencyMs };
    return { status: "ok", detail: `${label} connected (HTTP ${result.status}, ${via}).`, latencyMs };
  } catch (e) {
    return { status: "unreachable", detail: `Could not reach ${label}: ${e instanceof Error ? e.message : "network error"}` };
  }
}

async function checkGeminiBackup(): Promise<Partial_> {
  return checkChatKey(
    "GEMINI_BACKUP_API_KEY",
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
  );
}

async function checkLedgerly(): Promise<Partial_> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("ledgerly_settings").select("enabled, api_key").eq("id", 1).maybeSingle();
  if (!data?.api_key) return { status: "missing", detail: "No Ledgerly key saved.", fix: "Paste a key in the Ledgerly card below." };
  const { pingLedgerly } = await import("@/lib/ledgerly.server");
  try {
    const t0 = Date.now();
    const r = await pingLedgerly(data.api_key);
    const latencyMs = Date.now() - t0;
    if (r.status === 200) return { status: data.enabled ? "ok" : "degraded", detail: data.enabled ? "Key valid · sync on." : "Key valid · sync switched off.", latencyMs };
    return { status: "invalid", detail: `Ledgerly HTTP ${r.status}.`, fix: "Paste a fresh Ledgerly key.", latencyMs };
  } catch (e) {
    return { status: "unreachable", detail: `Could not reach Ledgerly: ${e instanceof Error ? e.message : "timeout"}` };
  }
}

type Spec = Pick<HealthCheck, "key" | "label" | "group" | "required" | "secret" | "help"> & {
  run: () => Promise<Partial_> | Partial_;
};

const OR_HDR = { "HTTP-Referer": "https://ogbot.co.uk", "X-Title": "OG BOT" };
/** OpenRouter's best free model right now (picked from its live list). */
async function foulModel(): Promise<string> {
  const or = await import("./openrouter-models.server");
  await or.loadOpenRouterModels();
  return or.openRouterFreeModels()[0];
}

const SPECS: Spec[] = [
  { key: "openrouter", label: "OpenRouter (Foul Mouth model)", secret: "FREE_OPENROUTER_API_KEY", help: "openrouter.ai/keys", group: "AI chat & lyrics", required: true,
    run: async () => checkChatKey("FREE_OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/chat/completions", await foulModel(), OR_HDR) },
  { key: "openrouter_backup", label: "OpenRouter backup", secret: "FREE_OPENROUTER_API_KEY_2", help: "openrouter.ai/keys", group: "AI chat & lyrics", required: false,
    run: async () => checkChatKey("FREE_OPENROUTER_API_KEY_2", "https://openrouter.ai/api/v1/chat/completions", await foulModel(), OR_HDR) },
  { key: "gemini", label: "Gemini (main, paid)", secret: "PAID_GEMINI_F196", help: "aistudio.google.com/apikey", group: "AI chat & lyrics", required: true, run: checkGemini },
  { key: "gemini_backup", label: "Gemini emergency backup (lyrics & image edits)", secret: "GEMINI_BACKUP_API_KEY", help: "aistudio.google.com/apikey", group: "AI chat & lyrics", required: false, run: checkGeminiBackup },
  ...["FREE_GEMINI_API_KEY_1", "FREE_GEMINI_API_KEY_2", "FREE_GEMINI_API_KEY_3", "FREE_GEMINI_API_KEY_4"].map((secret, i) => ({
    key: `gemini_free_${i + 1}`, label: `Gemini free key ${i + 1} (lyrics)`, secret, help: "aistudio.google.com/apikey", group: "AI chat & lyrics" as HealthGroup, required: false,
    run: async (): Promise<Partial_> => {
      const k = envKey(secret);
      if (!k) return missing(secret);
      const { result, latencyMs } = await timed(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`));
      return result.ok ? { status: "ok", detail: "Key accepted by Google.", latencyMs } : { status: "invalid", detail: `Google rejected the key (HTTP ${result.status}).`, latencyMs };
    },
  })),
  { key: "groq", label: "Groq (Foul Mouth off only)", secret: "FREE_GROQ_API_KEY", help: "console.groq.com/keys", group: "AI chat & lyrics", required: false,
    run: () => checkChatKey("FREE_GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b") },
  { key: "groq_backup", label: "Groq backup", secret: "FREE_GROQ_API_KEY_2", help: "console.groq.com/keys", group: "AI chat & lyrics", required: false,
    run: () => checkChatKey("FREE_GROQ_API_KEY_2", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b") },
  { key: "pollinations", label: "Pollinations (Foul Mouth off only)", secret: "FREE_POLLINATIONS_API_KEY", help: "enter.pollinations.ai", group: "AI chat & lyrics", required: false,
    run: () => checkChatKey("FREE_POLLINATIONS_API_KEY", "https://gen.pollinations.ai/v1/chat/completions", "openai-fast") },
  { key: "pollinations_backup", label: "Pollinations backup", secret: "FREE_POLLINATIONS_API_KEY_2", help: "enter.pollinations.ai", group: "AI chat & lyrics", required: false,
    run: () => checkChatKey("FREE_POLLINATIONS_API_KEY_2", "https://gen.pollinations.ai/v1/chat/completions", "openai-fast") },
  { key: "hub_free_keys", label: "Shared free keys (hub, every app)", secret: "OG_HUB_SERVICE_KEY", help: "hub → Edge Functions → Secrets", group: "AI chat & lyrics", required: false,
    run: checkHubFreeKeys },
  { key: "pollinations_free", label: "Pollinations free (no key needed, last resort)", group: "AI chat & lyrics", required: false,
    run: checkPollinationsNoKey },
  { key: "suno", label: "Suno (song generation)", secret: "SUNO_API_KEY", help: "sunoapi.org", group: "Music", required: true, run: checkSuno },
  { key: "stripe", label: "Stripe (card checkout)", secret: "STRIPE_SECRET_KEY", help: "dashboard.stripe.com/apikeys", group: "Payments", required: true, run: checkStripe },
  { key: "ledgerly", label: "Ledgerly bookkeeping", group: "Payments", required: false, run: checkLedgerly },
  { key: "og_bot_token", label: "OG B0T token (@BotFather)", secret: "OG_BOT_TOKEN", help: "t.me/BotFather", group: "Telegram", required: true, run: checkOgBotToken },
  { key: "telegram", label: "Telegram connection", secret: "TELEGRAM_API_KEY", group: "Telegram", required: false,
    run: () => checkGateway("TELEGRAM_API_KEY", "telegram", "/getMe", "Telegram") },
  { key: "drive", label: "Google Drive (purchase review & backups)", secret: "GOOGLE_DRIVE_API_KEY", group: "Google", required: false,
    run: () => checkGateway("GOOGLE_DRIVE_API_KEY", "google_drive", "/drive/v3/about?fields=user", "Google Drive") },
  { key: "sheets", label: "Google Sheets (sync)", secret: "GOOGLE_SHEETS_API_KEY", group: "Google", required: false,
    run: () => checkGateway("GOOGLE_SHEETS_API_KEY", "google_sheets", "/v4/spreadsheets/ping", "Google Sheets") },
  { key: "lovable_ai", label: "Connected-services gateway", group: "Core", required: true, run: checkLovable },
  { key: "og_bot_host", label: "OG_BOT_HOST", secret: "OG_BOT_HOST", group: "Bot hosting", required: true, run: () => checkUrlSecret("OG_BOT_HOST", "OG B0T host") },
  { key: "og_bot_mothership", label: "OG_BOT_MOTHERSHIP_URL", secret: "OG_BOT_MOTHERSHIP_URL", group: "Bot hosting", required: true, run: () => checkUrlSecret("OG_BOT_MOTHERSHIP_URL", "OG B0T mothership") },
  { key: "og_bot_mint_secret", label: "OG_BOT_REMOTE_MINT_SECRET", secret: "OG_BOT_REMOTE_MINT_SECRET", group: "Bot hosting", required: true, run: () => checkMintSecret() },
];

async function runSpec(spec: Spec): Promise<HealthCheck> {
  const base = { key: spec.key, label: spec.label, group: spec.group, required: spec.required, secret: spec.secret, help: spec.help };
  try {
    return { ...base, ...(await spec.run()) };
  } catch (e) {
    return { ...base, status: "unreachable", detail: e instanceof Error ? e.message : "Check threw an unexpected error.", fix: "Re-run the check." };
  }
}

export const runApiHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HealthReport> => {
    await assertAdmin(context);
    const checks = await Promise.all(SPECS.map(runSpec));
    const failCount = checks.filter((c) => c.status !== "ok").length;
    return {
      checkedAt: new Date().toISOString(),
      healthy: checks.every((c) => c.status === "ok" || !c.required),
      okCount: checks.length - failCount,
      failCount,
      checks,
    };
  });

/** Ping one key on demand. */
export const pingApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { key: string }) => ({ key: String(d?.key ?? "").slice(0, 60) }))
  .handler(async ({ data, context }): Promise<HealthCheck> => {
    await assertAdmin(context);
    const spec = SPECS.find((s) => s.key === data.key);
    if (!spec) throw new Error("Unknown key");
    return runSpec(spec);
  });
