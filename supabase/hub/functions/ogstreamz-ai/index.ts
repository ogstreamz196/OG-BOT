// ogstreamz-ai: the shared free AI keys for every OGSTREAMZ app (the owner,
// 2026-11-07: "these will be the free keys for all sub projects"). The keys
// live only here, as the hub's Edge Function secrets FREE_GROQ_API_KEY,
// FREE_OPENROUTER_API_KEY, FREE_POLLINATIONS_API_KEY (each with _2, ...) and
// FREE_GEMINI_API_KEY_1.._N. An app's server sends an ordinary OpenAI-style
// chat request here instead of to the provider:
//
//   POST /functions/v1/ogstreamz-ai?provider=groq&app=og_vault
//   Authorization: Bearer <the hub's secret key>   (servers only)
//   body: exactly what the provider's /chat/completions takes (stream ok)
//
// It tries each of that provider's free keys in turn (moving on when one is
// rejected, rate-limited or the provider errors) and passes the provider's
// answer straight back, streams included. Free keys only: the paid Gemini
// key is never used here. Never returns or logs a key or a message.
//
// Deployed to the hub with JWT checks off (the new secret keys aren't JWTs);
// it checks the caller's key itself. Source of record: this file.

const PROVIDERS: Record<string, { url: string; secret: string; extra?: Record<string, string> }> = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", secret: "GROQ" },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    secret: "OPENROUTER",
    extra: { "HTTP-Referer": "https://ogstreamz.co.uk", "X-Title": "OGSTREAMZ" },
  },
  pollinations: { url: "https://gen.pollinations.ai/v1/chat/completions", secret: "POLLINATIONS" },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    secret: "GEMINI",
  },
};
/** Statuses where the next key may do better. */
const NEXT_KEY = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504]);
const MAX_BODY = 2_000_000;

const env = (k: string) => Deno.env.get(k)?.trim() || "";

/** Every free key for a provider: FREE_X_API_KEY, then _1.._9, no repeats. */
function freeKeys(p: string): string[] {
  const names = [
    `FREE_${p}_API_KEY`,
    ...Array.from({ length: 9 }, (_, i) => `FREE_${p}_API_KEY_${i + 1}`),
  ];
  return [...new Set(names.map(env).filter(Boolean))];
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Callers proven to hold a hub secret key, by hash, for ten minutes.
const trusted = new Map<string, number>();
/** True for the hub's service role key or one of its secret keys (servers only). */
async function isHubServer(req: Request): Promise<boolean> {
  const key =
    req.headers.get("apikey")?.trim() ||
    req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    "";
  if (!key || key.startsWith("sb_publishable_")) return false;
  if (key === env("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const h = await sha(key);
  if ((trusted.get(h) ?? 0) > Date.now()) return true;
  // A secret key can list users; a publishable key or a member's token can't.
  try {
    const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users?per_page=1`, {
      headers: {
        apikey: key,
        ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return false;
  } catch {
    return false;
  }
  trusted.set(h, Date.now() + 10 * 60_000);
  return true;
}

// GET ?check=1: how many free keys each provider has and whether each is
// accepted (HTTP status of a free model-list call only), cached 5 minutes.
let checked: { at: number; result: Record<string, number[]> } | null = null;
const MODEL_LISTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/key",
  pollinations: "https://gen.pollinations.ai/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/models",
};
async function checkKeys() {
  if (checked && Date.now() - checked.at < 5 * 60_000) return checked.result;
  const result: Record<string, number[]> = {};
  await Promise.all(
    Object.entries(PROVIDERS).map(async ([name, p]) => {
      result[name] = await Promise.all(
        freeKeys(p.secret).map(async (k) => {
          try {
            const r = await fetch(MODEL_LISTS[name], {
              headers: { Authorization: `Bearer ${k}` },
              signal: AbortSignal.timeout(6_000),
            });
            await r.body?.cancel();
            return r.status;
          } catch {
            return 0;
          }
        }),
      );
    }),
  );
  checked = { at: Date.now(), result };
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "GET" && new URL(req.url).searchParams.get("check") === "1")
    return reply({ keys: await checkKeys() });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const u = new URL(req.url);
  const provider = PROVIDERS[u.searchParams.get("provider") ?? ""];
  if (!provider) return reply({ error: "unknown provider" }, 400);
  if (!(await isHubServer(req))) return reply({ error: "not allowed" }, 401);
  const keys = freeKeys(provider.secret);
  if (!keys.length) return reply({ error: "no free key for this provider" }, 503);
  const body = await req.text();
  if (body.length > MAX_BODY) return reply({ error: "too big" }, 413);
  const app = (u.searchParams.get("app") ?? "unknown").slice(0, 30);

  let last: Response | null = null;
  for (let i = 0; i < keys.length; i++) {
    let res: Response;
    try {
      res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keys[i]}`,
          ...(provider.extra ?? {}),
        },
        body,
        signal: req.signal,
      });
    } catch {
      console.warn(
        `[ogstreamz-ai] ${app} ${u.searchParams.get("provider")} key ${i + 1} no answer`,
      );
      continue;
    }
    if (NEXT_KEY.has(res.status) && i < keys.length - 1) {
      console.warn(
        `[ogstreamz-ai] ${app} ${u.searchParams.get("provider")} key ${i + 1} ${res.status}`,
      );
      await res.body?.cancel();
      continue;
    }
    last = res;
    break;
  }
  if (!last) return reply({ error: "provider unreachable" }, 502);
  // The provider's answer as is (JSON or a stream), without its own headers.
  return new Response(last.body, {
    status: last.status,
    headers: { "Content-Type": last.headers.get("Content-Type") ?? "application/json" },
  });
});
