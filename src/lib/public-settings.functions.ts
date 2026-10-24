import { createServerFn } from "@tanstack/react-start";

/**
 * Public app settings that members' browsers can't read directly (the
 * app_settings read policy only lists some keys). Prices and the free-access
 * end date are shown to everyone, so they're served here instead.
 */
export const getPublicAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "coins_per_remake",
      "coins_per_lyric_video",
      "free_access_all",
      "free_access_expires_at",
      "signals_portal_enabled",
    ]);
  const map: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>)
    map[row.key] = row.value;
  const num = (v: unknown): number | null =>
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const exp = map.free_access_expires_at;
  return {
    coins_per_remake: num(map.coins_per_remake),
    coins_per_lyric_video: num(map.coins_per_lyric_video),
    free_access_all: map.free_access_all === true || map.free_access_all === "true",
    free_access_expires_at: typeof exp === "string" && exp ? exp : null,
    // On unless the Boss has switched it off.
    signals_portal_enabled:
      map.signals_portal_enabled !== false && map.signals_portal_enabled !== "false",
  };
});
