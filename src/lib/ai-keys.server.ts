// Extra AI keys the Boss adds in Boss → System → API keys: free Pollinations,
// OpenRouter and Gemini keys, as many as they like. They're kept off Lovable,
// in the OGSTREAMZ hub's og_bot.ai_keys (supabase/hub/03_ai_keys.sql),
// encrypted with AES-GCM under a key derived from the hub's secret key, so
// the database itself never holds a readable key. OG B0T's server reaches the
// hub with OG_HUB_SERVICE_KEY (and OG_HUB_URL, defaulting to the hub). The AI
// router (ai-endpoint.server.ts) tries these first, then the keys it already
// had. Without the hub secret, or if the hub can't be reached, nothing
// changes: the old keys carry on. Never log or return a key.

export const AI_KEY_PROVIDERS = ["pollinations", "openrouter", "gemini"] as const;
export type AiKeyProvider = (typeof AI_KEY_PROVIDERS)[number];

export const AI_KEY_NAMES: Record<AiKeyProvider, string> = {
  pollinations: "Pollinations (free)",
  openrouter: "OpenRouter (free models)",
  gemini: "Gemini (free tier)",
};

const DEFAULT_HUB_URL = "https://zqwngcndkxgxuwqyxihi.supabase.co";
const TABLE = "ai_keys";

export type StoredAiKey = {
  id: string;
  provider: AiKeyProvider;
  label: string | null;
  key_enc: string;
  key_hint: string | null;
  enabled: boolean;
  last_status: string | null;
  last_checked_at: string | null;
  created_at: string;
};

/** What the Boss's page sees: never the key, only its last four characters. */
export type AiKeyRow = Omit<StoredAiKey, "key_enc">;

/** The last four characters, for telling keys apart. Pure. */
export function keyHint(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? "••••" : `••••${k.slice(-4)}`;
}

/** A pasted key, tidied: no spaces, quotes or "Bearer ". Null when it can't be a key. Pure. */
export function cleanKey(raw: string): string | null {
  const unquote = (v: string) =>
    v
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  const k = unquote(unquote(raw).replace(/^bearer\s+/i, ""));
  return k.length >= 12 && k.length <= 400 && !/\s/.test(k) ? k : null;
}

function hubConfig(): { url: string; key: string } | null {
  const key = process.env.OG_HUB_SERVICE_KEY;
  if (!key) return null;
  return { url: (process.env.OG_HUB_URL || DEFAULT_HUB_URL).replace(/\/+$/, ""), key };
}

/**
 * The hub's shared free AI keys (the Boss, 2026-11-07: the hub's FREE_* keys
 * are the free keys for every app): an OpenAI-style chat URL and headers for
 * the hub Edge Function ogstreamz-ai, which holds the keys and tries each in
 * turn. Null without OG_HUB_SERVICE_KEY. Never exposes a provider key.
 */
export function hubAiEndpoint(
  provider: "groq" | "openrouter" | "pollinations" | "gemini",
): { url: string; headers: Record<string, string> } | null {
  const cfg = hubConfig();
  if (!cfg) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: cfg.key };
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
  return {
    url: `${cfg.url}/functions/v1/ogstreamz-ai?provider=${provider}&app=og_bot`,
    headers,
  };
}

/** Whether the hub secret is set (the page says what to do when it isn't). */
export function hubKeySet(): boolean {
  return !!hubConfig();
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cryptKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`og-bot-ai-keys:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** "v1.<iv>.<ciphertext>", AES-GCM. */
export async function sealKey(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptKey(secret),
    new TextEncoder().encode(plain),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

/** The key back, or null when it was sealed under another secret. */
export async function openKey(sealed: string, secret: string): Promise<string | null> {
  try {
    const [v, iv, ct] = sealed.split(".");
    if (v !== "v1" || !iv || !ct) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await cryptKey(secret),
      unb64(ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

async function hub(path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = hubConfig();
  if (!cfg) throw new Error("hub key not set");
  const headers: Record<string, string> = {
    apikey: cfg.key,
    "Accept-Profile": "og_bot",
    "Content-Profile": "og_bot",
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  // Legacy service-role keys are JWTs and go in Authorization too.
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
  return fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(8_000),
  });
}

/** Why the hub said no, in plain words for the Boss (never the key). */
async function hubError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403)
    return "The hub refused the key. Check OG_HUB_SERVICE_KEY is the hub's secret key.";
  if (res.status === 406 || /PGRST106|schema must be one of/i.test(text))
    return "The hub isn't sharing og_bot yet: add og_bot to its exposed schemas.";
  if (res.status === 404 || /PGRST205|does not exist/i.test(text))
    return "The keys table isn't in the hub yet (supabase/hub/03_ai_keys.sql).";
  return `The hub answered HTTP ${res.status}.`;
}

/** Every stored key for the Boss's page (no key material). */
export async function listAiKeys(): Promise<{ rows: AiKeyRow[]; problem: string | null }> {
  if (!hubConfig()) return { rows: [], problem: "not_connected" };
  try {
    const res = await hub(
      `${TABLE}?select=id,provider,label,key_hint,enabled,last_status,last_checked_at,created_at&order=created_at.asc`,
    );
    if (!res.ok) return { rows: [], problem: await hubError(res) };
    return { rows: (await res.json()) as AiKeyRow[], problem: null };
  } catch {
    return { rows: [], problem: "The hub couldn't be reached just now." };
  }
}

export async function addAiKey(provider: AiKeyProvider, rawKey: string, label: string | null) {
  const cfg = hubConfig();
  if (!cfg) throw new Error("Add OG_HUB_SERVICE_KEY first.");
  const key = cleanKey(rawKey);
  if (!key) throw new Error("That doesn't look like a key.");
  const res = await hub(TABLE, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      provider,
      label: label?.trim().slice(0, 60) || null,
      key_enc: await sealKey(key, cfg.key),
      key_hint: keyHint(key),
    }),
  });
  if (!res.ok) throw new Error(await hubError(res));
  forgetAiKeys();
}

export async function setAiKey(id: string, patch: { enabled?: boolean; last_status?: string }) {
  const body: Record<string, unknown> = { ...patch };
  if (patch.last_status !== undefined) body.last_checked_at = new Date().toISOString();
  const res = await hub(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await hubError(res));
  forgetAiKeys();
}

/**
 * Swaps a stored key for a new one in place: same provider, name and spot in
 * the order, switched on, test result cleared. The old key is overwritten.
 */
export async function replaceAiKey(id: string, rawKey: string) {
  const cfg = hubConfig();
  if (!cfg) throw new Error("Add OG_HUB_SERVICE_KEY first.");
  const key = cleanKey(rawKey);
  if (!key) throw new Error("That doesn't look like a key.");
  const res = await hub(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      key_enc: await sealKey(key, cfg.key),
      key_hint: keyHint(key),
      enabled: true,
      last_status: null,
      last_checked_at: null,
    }),
  });
  if (!res.ok) throw new Error(await hubError(res));
  forgetAiKeys();
}

/** Removes a key the Boss added (their own setting, not trade data). */
export async function removeAiKey(id: string) {
  const res = await hub(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(await hubError(res));
  forgetAiKeys();
}

/** One stored key, readable, for a test call. */
export async function revealForTest(
  id: string,
): Promise<{ provider: AiKeyProvider; key: string } | null> {
  const cfg = hubConfig();
  if (!cfg) return null;
  const res = await hub(`${TABLE}?select=provider,key_enc&id=eq.${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const row = ((await res.json()) as Pick<StoredAiKey, "provider" | "key_enc">[])[0];
  if (!row) return null;
  const key = await openKey(row.key_enc, cfg.key);
  return key ? { provider: row.provider, key } : null;
}

export type ExtraKeys = Record<AiKeyProvider, string[]>;
const EMPTY: ExtraKeys = { pollinations: [], openrouter: [], gemini: [] };
const CACHE_MS = 60_000;
let cache: { at: number; keys: ExtraKeys } | null = null;
let loading: Promise<ExtraKeys> | null = null;

/** Forget the cached keys (after the Boss adds, switches or removes one). */
export function forgetAiKeys() {
  cache = null;
}

/** The last keys loaded, for the router's sync target lists. */
export function extraKeysNow(): ExtraKeys {
  return cache?.keys ?? EMPTY;
}

/**
 * The switched-on extra keys, readable, oldest first (cached a minute).
 * Never throws: on any problem the router just uses the keys it already had.
 */
export async function loadExtraKeys(now = Date.now()): Promise<ExtraKeys> {
  if (cache && now - cache.at < CACHE_MS) return cache.keys;
  const cfg = hubConfig();
  if (!cfg) return EMPTY;
  loading ??= (async () => {
    try {
      const res = await hub(
        `${TABLE}?select=provider,key_enc&enabled=eq.true&order=created_at.asc`,
      );
      if (!res.ok) throw new Error("hub");
      const rows = (await res.json()) as Pick<StoredAiKey, "provider" | "key_enc">[];
      const keys: ExtraKeys = { pollinations: [], openrouter: [], gemini: [] };
      for (const r of rows) {
        if (!(AI_KEY_PROVIDERS as readonly string[]).includes(r.provider)) continue;
        const k = await openKey(r.key_enc, cfg.key);
        if (k) keys[r.provider].push(k);
      }
      cache = { at: Date.now(), keys };
      return keys;
    } catch {
      // Try again in a minute; keep what we had meanwhile.
      cache = { at: Date.now(), keys: cache?.keys ?? EMPTY };
      return cache.keys;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
