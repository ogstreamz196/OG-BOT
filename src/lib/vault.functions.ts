import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertBoss(ctx: { supabase: any; userId: string }) {
  const [b, a] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "boss" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
  ]);
  if (!b.data && !a.data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "ogv_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const listVaultCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertBoss(context);
    const { data, error } = await db
      .from("vip_pass_credentials")
      .select("id,username,password,note,active,created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addVaultCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { username: string; password: string; note?: string }) => {
    const username = String(d.username ?? "").trim();
    const password = String(d.password ?? "").trim();
    if (!username || username.length > 120) throw new Error("Enter a username (max 120)");
    if (!password || password.length > 120) throw new Error("Enter a PIN/password (max 120)");
    return { username, password, note: d.note?.trim().slice(0, 200) || null };
  })
  .handler(async ({ data, context }) => {
    const db = await assertBoss(context);
    const { data: row, error } = await db
      .from("vip_pass_credentials")
      .insert({ ...data, active: true, created_by: context.userId })
      .select("id,username,password,note,active")
      .single();
    if (error) throw new Error(error.message.includes("duplicate") ? "That username already exists" : error.message);
    const { sendVaultWebhook } = await import("./vault-webhook.server");
    const hook = await sendVaultWebhook("vault_credential.created", row);
    return { ok: true, hook };
  });

export const setVaultCredentialActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) => ({ id: String(d.id), active: !!d.active }))
  .handler(async ({ data, context }) => {
    const db = await assertBoss(context);
    const { data: row, error } = await db
      .from("vip_pass_credentials")
      .update({ active: data.active })
      .eq("id", data.id)
      .select("id,username,password,note,active")
      .single();
    if (error) throw new Error(error.message);
    const { sendVaultWebhook } = await import("./vault-webhook.server");
    const hook = await sendVaultWebhook("vault_credential.updated", row);
    return { ok: true, hook };
  });

export const deleteVaultCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data, context }) => {
    const db = await assertBoss(context);
    const { data: row } = await db.from("vip_pass_credentials").select("username").eq("id", data.id).maybeSingle();
    // Owned passes reference a credential, so retire it instead of hard-deleting when in use.
    const { count } = await db
      .from("vip_pass_purchases")
      .select("id", { count: "exact", head: true })
      .eq("credential_id", data.id);
    const { error } = (count ?? 0) > 0
      ? await db.from("vip_pass_credentials").update({ active: false }).eq("id", data.id)
      : await db.from("vip_pass_credentials").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const { sendVaultWebhook } = await import("./vault-webhook.server");
    const hook = await sendVaultWebhook("vault_credential.deleted", { id: data.id, username: row?.username ?? null });
    return { ok: true, hook };
  });

export const getVaultWebhookSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertBoss(context);
    let { data } = await db.from("vault_webhook_settings").select("*").eq("id", 1).maybeSingle();
    if (!data?.secret) {
      // Create the API key straight away so Boss can copy it before anything else is set up.
      const { data: made } = await db
        .from("vault_webhook_settings")
        .upsert({ id: 1, secret: randomSecret() }, { onConflict: "id" })
        .select("*")
        .single();
      data = made ?? data;
    }
    return {
      enabled: !!data?.enabled,
      targetUrl: data?.target_url ?? "",
      secret: data?.secret ?? "",
      lastTestOk: data?.last_test_ok ?? null,
      lastTestAt: data?.last_test_at ?? null,
      lastSentAt: data?.last_sent_at ?? null,
      lastError: data?.last_error ?? null,
    };
  });

export const saveVaultWebhookSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; targetUrl: string; regenerateSecret?: boolean }) => {
    const url = String(d.targetUrl ?? "").trim();
    if (url && (!/^https:\/\/\S+$/i.test(url) || url.length > 500)) throw new Error("Use a full https:// URL");
    return { enabled: !!d.enabled, targetUrl: url, regenerateSecret: !!d.regenerateSecret };
  })
  .handler(async ({ data, context }) => {
    const db = await assertBoss(context);
    const { data: cur } = await db.from("vault_webhook_settings").select("secret").eq("id", 1).maybeSingle();
    const secret = data.regenerateSecret || !cur?.secret ? randomSecret() : cur.secret;
    const { error } = await db.from("vault_webhook_settings").upsert({
      id: 1,
      enabled: data.enabled && !!data.targetUrl,
      target_url: data.targetUrl || null,
      secret,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testVaultWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { sendVaultWebhook } = await import("./vault-webhook.server");
    return sendVaultWebhook("vault.ping", { message: "OG Vault test ping" }, { force: true });
  });

/** Pushes every credential to the other app (useful right after setting it up). */
export const resyncVaultWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertBoss(context);
    const { data } = await db.from("vip_pass_credentials").select("id,username,password,note,active");
    const { sendVaultWebhook } = await import("./vault-webhook.server");
    let sent = 0;
    for (const row of data ?? []) {
      const r = await sendVaultWebhook("vault_credential.updated", row, { force: true });
      if (!r.ok) return { ok: false, sent, message: r.message };
      sent++;
    }
    return { ok: true, sent, message: `Sent ${sent} logins` };
  });
