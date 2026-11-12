import {
  cleanEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  ENGINE_CONFIG_KEY,
  type EngineConfig,
} from "./engine-config";

// The admin Supabase client; typed loosely (as elsewhere in the bot code) so
// the real client's query builders fit without fighting generated types.
type Admin = {
  from: (t: string) => any;
};

/**
 * Save the engine-wide config (used by the signals bot's strategy card, which
 * runs server-side with the admin client). Clamps to the bounds, clears the
 * cache so the next scan reads it, and audit-logs the change. Returns the
 * cleaned config that was stored.
 */
export async function saveEngineConfig(
  admin: Admin,
  config: unknown,
  actorId?: string,
): Promise<EngineConfig> {
  const clean = cleanEngineConfig(config);
  const { error } = await admin
    .from("app_settings")
    .upsert({ key: ENGINE_CONFIG_KEY, value: JSON.stringify(clean) }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  const { forgetCached } = await import("./server-cache");
  forgetCached("signals-engine-config");
  try {
    await admin.from("boss_audit_log").insert({
      actor_id: actorId ?? null,
      action: "save_engine_config",
      category: "signals",
      target_key: ENGINE_CONFIG_KEY,
      metadata: { via: "telegram_strategies" },
    });
  } catch {
    /* the audit log is best-effort */
  }
  return clean;
}

/**
 * The live engine-wide config (the gate and concurrency limits), cached for a
 * minute and always safe: any error or missing row falls back to the defaults,
 * which equal the original code constants. Read by the live posting path.
 */
export async function engineConfig(): Promise<EngineConfig> {
  try {
    const { cached } = await import("./server-cache");
    return await cached("signals-engine-config", 60_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", ENGINE_CONFIG_KEY)
        .maybeSingle();
      const raw = (data as { value?: string } | null)?.value;
      let parsed: unknown = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      return cleanEngineConfig(parsed);
    });
  } catch {
    return DEFAULT_ENGINE_CONFIG;
  }
}
