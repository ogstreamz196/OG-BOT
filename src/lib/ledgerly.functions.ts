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

function mask(key: string) {
  const prefix = key.startsWith("lk_live_") ? "lk_live_" : key.slice(0, 3);
  return `${prefix}••••••••${key.slice(-4)}`;
}

export const getLedgerlySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertBoss(context);
    const { data } = await db.from("ledgerly_settings").select("*").eq("id", 1).maybeSingle();
    const key = data?.api_key ?? "";
    return {
      enabled: !!data?.enabled,
      hasKey: !!key,
      keyHint: key ? mask(key) : null,
      keyName: data?.key_name ?? null,
      lastTestOk: data?.last_test_ok ?? null,
      lastTestAt: data?.last_test_at ?? null,
      lastSyncAt: data?.last_sync_at ?? null,
      lastError: data?.last_error ?? null,
    };
  });

export const saveLedgerlySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; apiKey?: string; removeKey?: boolean }) => {
    if (d.apiKey && (d.apiKey.length > 300 || !/^\S+$/.test(d.apiKey.trim()))) throw new Error("Invalid key");
    return { enabled: !!d.enabled, apiKey: d.apiKey?.trim() || undefined, removeKey: !!d.removeKey };
  })
  .handler(async ({ data, context }) => {
    const db = await assertBoss(context);
    const patch: Record<string, unknown> = { enabled: data.enabled, updated_at: new Date().toISOString() };
    if (data.removeKey) Object.assign(patch, { api_key: null, enabled: false, key_name: null, last_test_ok: null, last_error: null });
    else if (data.apiKey) Object.assign(patch, { api_key: data.apiKey, key_name: null, last_test_ok: null, last_error: null });
    const { error } = await db.from("ledgerly_settings").update(patch as never).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Uses GET /ping — never creates a transaction. */
export const testLedgerlyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertBoss(context);
    const { data } = await db.from("ledgerly_settings").select("api_key").eq("id", 1).maybeSingle();
    if (!data?.api_key) return { ok: false, message: "Save an API key first" };
    const { pingLedgerly } = await import("./ledgerly.server");
    let ok = false;
    let message = "";
    let keyName: string | null = null;
    try {
      const r = await pingLedgerly(data.api_key);
      if (r.status === 200 && r.body.ok) {
        ok = true;
        keyName = r.body.key_name ?? null;
        message = `Connected to Ledgerly as ${keyName ?? "this key"}`;
      } else if (r.status === 401) message = "Invalid or revoked API key";
      else if (r.status === 403) message = r.body.error ?? r.body.message ?? "Plan/feature not enabled";
      else message = `HTTP ${r.status}: ${r.body.error ?? r.body.message ?? "unexpected response"}`;
    } catch (e) {
      message = e instanceof Error ? e.message : "Network error";
    }
    await db
      .from("ledgerly_settings")
      .update({ last_test_ok: ok, last_test_at: new Date().toISOString(), last_error: ok ? null : message, ...(ok ? { key_name: keyName } : {}) })
      .eq("id", 1);
    return { ok, message };
  });
