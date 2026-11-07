import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_STRATEGIES,
  STRATEGIES_KEY,
  cleanStrategy,
  parseStrategies,
  type SignalStrategy,
} from "./signal-strategies";

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

/** Boss: the saved signal strategies. */
export const getStrategies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", STRATEGIES_KEY)
      .maybeSingle();
    return { strategies: parseStrategies((data as { value?: string } | null)?.value) };
  });

/**
 * Boss: replace the whole strategy list. Each one is cleaned and its knobs
 * clamped to the engine's bounds (safeTuning) before it's stored, so nothing
 * unsafe can be saved from the panel.
 */
export const saveStrategies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { strategies: SignalStrategy[] } => {
    const list = (d as { strategies?: unknown } | null)?.strategies;
    if (!Array.isArray(list)) throw new Error("Bad strategies");
    const cleaned = list
      .slice(0, MAX_STRATEGIES)
      .map(cleanStrategy)
      .filter((s): s is SignalStrategy => !!s);
    return { strategies: cleaned };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { safeTuning } = await import("./signal-learning.server");
    const strategies = data.strategies.map((s) => ({ ...s, tuning: safeTuning(s.tuning) }));
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: STRATEGIES_KEY, value: JSON.stringify(strategies) }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "save_signal_strategies",
      category: "signals",
      target_key: STRATEGIES_KEY,
      metadata: { count: strategies.length },
    });
    return { ok: true as const, strategies };
  });
