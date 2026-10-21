// Ledgerly-style pull API: other apps call OG BOT with the Vault API key.
import { cached, forgetCached } from "@/lib/server-cache";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const SECRET_KEY = "vault-api-secret";
/** How often a working key's "last used" stamp is written (not every call). */
const STAMP_EVERY_MS = 5 * 60_000;
let lastStampAt = 0;

/** Returns the admin client when the Bearer key matches, else a 401 Response. */
export async function authorizeVaultApi(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const readSecret = async () => {
    const { data, error } = await supabaseAdmin
      .from("vault_webhook_settings")
      .select("secret")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.secret as string | null) ?? null;
  };
  // Cached for 30s; a mismatch re-reads once, so a freshly rotated key works
  // straight away (a revoked one stops within 30s).
  let secret = await cached(SECRET_KEY, 30_000, readSecret);
  if (!secret || !safeEqual(token, secret)) {
    forgetCached(SECRET_KEY);
    secret = await cached(SECRET_KEY, 30_000, readSecret);
  }
  if (!secret || !safeEqual(token, secret)) {
    return { error: json({ ok: false, error: "Invalid or revoked API key" }, 401) };
  }
  if (Date.now() - lastStampAt > STAMP_EVERY_MS) {
    lastStampAt = Date.now();
    await supabaseAdmin
      .from("vault_webhook_settings")
      .update({ last_test_ok: true, last_test_at: new Date().toISOString(), last_error: null })
      .eq("id", 1);
  }
  return { db: supabaseAdmin };
}
