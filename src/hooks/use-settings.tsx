import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SETTINGS_QUERY_KEY, useAppSettingsRealtime } from "./app-settings-realtime";
import { getPublicAppSettings } from "@/lib/public-settings.functions";

export type AppSettings = {
  coins_per_generation: number;
  coins_per_lyrics_generation: number;
  coins_per_full_unlock: number;
  coins_per_lyric_video: number;
  /** Flat price to reveal a bonus take (read by reveal-variation). */
  coins_per_remake: number;
  coins_per_variation_divisor: number;
  songs_per_generation: number;
  sample_seconds: number;
  signup_credits: number;
};

const DEFAULTS: AppSettings = {
  coins_per_generation: 0,
  coins_per_lyrics_generation: 0,
  coins_per_full_unlock: 5,
  coins_per_lyric_video: 5,
  coins_per_remake: 2,
  coins_per_variation_divisor: 2,
  songs_per_generation: 2,
  sample_seconds: 60,
  signup_credits: 25,
};

export function useSettings() {
  // Live-sync: when boss edits app_settings (e.g. sample_seconds), refetch so
  // MusicHUB previews immediately respect the new cap without a page reload.
  useAppSettingsRealtime();

  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<AppSettings> => {
      const [{ data, error }, extra] = await Promise.all([
        supabase.from("app_settings").select("key, value"),
        // Prices members can't read directly (see public-settings.functions).
        getPublicAppSettings().catch(() => null),
      ]);
      if (error) throw error;
      const map: Record<string, unknown> = {};
      if (extra?.coins_per_remake != null) map.coins_per_remake = extra.coins_per_remake;
      if (extra?.coins_per_lyric_video != null)
        map.coins_per_lyric_video = extra.coins_per_lyric_video;
      for (const row of data ?? []) map[row.key] = row.value;
      const numOrDefault = (v: unknown, d: number) =>
        typeof v === "number"
          ? v
          : typeof v === "string" && Number.isFinite(Number(v))
            ? Number(v)
            : d;
      const out = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
        out[key] = numOrDefault(map[key], DEFAULTS[key]);
      }
      return out;
    },
  });
}
