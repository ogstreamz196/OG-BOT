// Shared one-login brain. The login accounts live in the OGSTREAMZ hub
// (a Supabase project), so the hub is the single place users log in and the
// shared secret (VAULT_LINK_SECRET) stays in Supabase only, never in Lovable.
// Trusted callers (the Vault server fn, the ogbot Lovable backend) reach it with
// the hub service-role bearer; an HMAC(x-vault-signature) over the raw body with
// VAULT_LINK_SECRET is also accepted. verify_jwt is off (we do our own auth).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("VAULT_LINK_SECRET") ?? "";
const USERNAME_DOMAIN = "ogstreamz.app";
const MAX_SKEW_MS = 2 * 60_000;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function loginEmail(username: string): string {
  const h = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return h ? `${h}@${USERNAME_DOMAIN}` : "";
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Per-email throttle (best effort; instances are ephemeral).
const tries = new Map<string, { n: number; until: number }>();
function locked(k: string): boolean {
  const t = tries.get(k);
  return !!t && t.until > Date.now() && t.n >= 5;
}
function fail(k: string): void {
  const now = Date.now();
  const t = tries.get(k);
  if (!t || t.until < now) tries.set(k, { n: 1, until: now + 15 * 60_000 });
  else t.n += 1;
  if (tries.size > 5000) tries.delete(tries.keys().next().value as string);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!SECRET || !SERVICE || !URL) return json({ ok: false, error: "not_configured" }, 503);

  const raw = await req.text();
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sig = req.headers.get("x-vault-signature");
  const byService = !!bearer && safeEq(bearer, SERVICE);
  const byHmac = !!sig && safeEq(sig.trim().toLowerCase(), await hmacHex(SECRET, raw));
  if (!byService && !byHmac) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { username?: unknown; password?: unknown; ts?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  // Strip any streaming-address prefix so the bot never stores or shows it;
  // the bot only ever sees the plain handle.
  const username = String(body?.username ?? "")
    .trim()
    .replace(/^m3u\./i, "");
  const password = String(body?.password ?? "");
  const ts = Number(body?.ts);
  if (username.length < 3 || username.length > 40 || password.length < 6 || password.length > 200)
    return json({ ok: false, error: "bad_request" }, 400);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS)
    return json({ ok: false, error: "expired" }, 401);

  const email = loginEmail(username);
  if (!email) return json({ ok: false, error: "bad_request" }, 400);
  if (locked(email)) return json({ ok: false, error: "too_many" }, 429);

  // Right password on an existing account -> signed in.
  const anon = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed } = await anon.auth.signInWithPassword({ email, password });
  if (signed?.user) return json({ ok: true, action: "signed_in" });

  // Otherwise try to make the account. Supabase Auth itself tells us whether the
  // login already exists, so we don't depend on any app-specific profile columns.
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: made } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // No origin marker: the account must not reveal that the person came in
    // through another app. It carries only their own display name.
    user_metadata: { display_name: username },
  });
  if (!made?.user) {
    // The email is already taken but the password didn't match it.
    fail(email);
    return json({ ok: false, action: "wrong_password" }, 401);
  }
  const linkCode = `t_${crypto.randomUUID().replace(/-/g, "")}`;
  return json({
    ok: true,
    action: "created",
    setup_url: "https://ogbot.co.uk/welcome",
    link_code: linkCode,
    telegram_url: `https://t.me/OGB0T_bot?start=${linkCode}`,
  });
});
