// Ledgerly-style pull API: other apps call OG BOT with the Vault API key.
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

/** Returns the admin client when the Bearer key matches, else a 401 Response. */
export async function authorizeVaultApi(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("vault_webhook_settings").select("secret").eq("id", 1).maybeSingle();
  if (!data?.secret || !safeEqual(token, data.secret)) {
    return { error: json({ ok: false, error: "Invalid or revoked API key" }, 401) };
  }
  await supabaseAdmin
    .from("vault_webhook_settings")
    .update({ last_test_ok: true, last_test_at: new Date().toISOString(), last_error: null })
    .eq("id", 1);
  return { db: supabaseAdmin };
}
