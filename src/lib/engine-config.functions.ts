import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cleanEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  ENGINE_BOUNDS,
  ENGINE_CONFIG_KEY,
} from "./engine-config";

async function assertBoss(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: string },
    ) => Promise<{ data: boolean | null }>;
  };
  const [admin, boss] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!admin.data && !boss.data) throw new Error("Forbidden");
}

/** Boss: the current engine-wide config, with the defaults and bounds. */
export const getEngineConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { engineConfig } = await import("./engine-config.server");
    return { config: await engineConfig(), defaults: DEFAULT_ENGINE_CONFIG, bounds: ENGINE_BOUNDS };
  });

/** Boss: set the engine-wide config. Clamped to the bounds; takes effect within a minute. */
export const saveEngineConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => cleanEngineConfig((d as { config?: unknown } | null)?.config))
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { forgetCached } = await import("./server-cache");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: ENGINE_CONFIG_KEY, value: JSON.stringify(data) }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    forgetCached("signals-engine-config");
    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "save_engine_config",
      category: "signals",
      target_key: ENGINE_CONFIG_KEY,
      metadata: {},
    });
    return { ok: true as const, config: data };
  });
