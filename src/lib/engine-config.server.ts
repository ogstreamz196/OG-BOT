import {
  cleanEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  ENGINE_CONFIG_KEY,
  type EngineConfig,
} from "./engine-config";

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
