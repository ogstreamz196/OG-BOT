// ogstreamz-metaapi: the Boss's MetaApi account (MT5 for the signals bot), kept in the OGSTREAMZ hub so
// its token never sits in OG B0T's own settings (independent of Lovable). It only forwards a fixed list of
// account calls the bot makes, for the one account in METAAPI_ACCOUNT_ID. Callers must hold a hub
// server key (the same check as ogstreamz-ai). Never returns, logs or stores the token.
//
//   POST { method: "GET"|"POST", path, body? }   with the hub service key
//
// Secrets (Edge Function secrets): METAAPI_TOKEN, METAAPI_ACCOUNT_ID, METAAPI_REGION (default new-york).
// Deployed with JWT checks off: the hub's new secret keys aren't JWTs; this checks the caller itself.

const env = (k: string) => Deno.env.get(k)?.trim() || "";
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The calls the bot makes, and nothing else. */
const ALLOWED: { method: string; re: RegExp }[] = [
  { method: "GET", re: /^\/account-information$/ },
  { method: "GET", re: /^\/positions$/ },
  { method: "GET", re: /^\/orders$/ },
  { method: "POST", re: /^\/trade$/ },
  { method: "GET", re: /^\/history-deals\/position\/[A-Za-z0-9_-]{1,40}$/ },
  { method: "GET", re: /^\/symbols\/[A-Za-z0-9._-]{1,30}\/current-price$/ },
];

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Callers proven to hold a hub secret key, by hash, for ten minutes (as ogstreamz-ai does).
const trusted = new Map<string, number>();
async function isHubServer(req: Request): Promise<boolean> {
  const key =
    req.headers.get("apikey")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";
  if (!key || key.startsWith("sb_publishable_")) return false;
  if (key === env("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const h = await sha(key);
  if ((trusted.get(h) ?? 0) > Date.now()) return true;
  try {
    const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return false;
  } catch {
    return false;
  }
  trusted.set(h, Date.now() + 10 * 60_000);
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!(await isHubServer(req))) return reply({ error: "not allowed" }, 401);
  const token = env("METAAPI_TOKEN");
  const account = env("METAAPI_ACCOUNT_ID");
  if (!token || !account) return reply({ error: "MetaApi isn't set up in the hub" }, 503);
  let b: { method?: string; path?: string; body?: unknown };
  try {
    b = await req.json();
  } catch {
    return reply({ error: "bad body" }, 400);
  }
  const method = (b.method ?? "GET").toUpperCase();
  const path = String(b.path ?? "");
  if (!ALLOWED.some((a) => a.method === method && a.re.test(path))) return reply({ error: "call not allowed" }, 400);
  const region = (env("METAAPI_REGION") || "new-york").replace(/[^a-z0-9-]/gi, "");
  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(account)}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { "auth-token": token, "Content-Type": "application/json" },
      body: b.body === undefined ? undefined : JSON.stringify(b.body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Logged for diagnosis: the status, the call and MetaApi's message (cut short). Never the token.
      const msg = typeof (data as { message?: unknown } | null)?.message === "string"
        ? String((data as { message: string }).message).slice(0, 160)
        : "";
      console.log(`metaapi ${method} ${path} -> ${res.status} ${msg}`);
    }
    return reply({ ok: res.ok, status: res.status, data }, 200);
  } catch {
    return reply({ ok: false, status: 0, data: null }, 200);
  }
});
