// Outbound OG Vault webhook: tells the owner's other apps which Vault logins to accept.
// Signed with HMAC-SHA256 (X-OG-Signature) and sent with a Bearer secret. Never throws.

export type VaultEvent =
  | "vault_credential.created"
  | "vault_credential.updated"
  | "vault_credential.deleted"
  | "vault.ping";

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendVaultWebhook(
  event: VaultEvent,
  data: Record<string, unknown>,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; status?: number; message: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: s } = await supabaseAdmin
    .from("vault_webhook_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (!s?.target_url || !s.secret) return { ok: false, message: "Add a target URL and secret first" };
  if (!s.enabled && !opts.force) return { ok: false, message: "Webhook is switched off" };
  const body = JSON.stringify({ event, timestamp: Date.now(), data });
  let ok = false;
  let status: number | undefined;
  let message = "";
  try {
    const res = await fetch(s.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.secret}`,
        "X-OG-Event": event,
        "X-OG-Signature": `sha256=${await hmac(s.secret, body)}`,
      },
      body,
      signal: AbortSignal.timeout(6000),
    });
    status = res.status;
    ok = res.ok;
    message = ok ? `Your other app replied ${res.status} OK` : `Your other app replied ${res.status}`;
  } catch (e) {
    message = e instanceof Error && e.name === "TimeoutError" ? "No reply within 6 seconds" : "Couldn't reach that URL";
  }
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("vault_webhook_settings")
    .update(
      event === "vault.ping"
        ? { last_test_ok: ok, last_test_at: now, last_error: ok ? null : message }
        : { last_sent_at: now, last_error: ok ? null : message },
    )
    .eq("id", 1);
  return { ok, status, message };
}
