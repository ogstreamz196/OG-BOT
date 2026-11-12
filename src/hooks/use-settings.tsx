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
  /** Welcome coins for a new account (grant_welcome_bonus). */
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
  signup_credits: 20,
};

export function useSettings() {
  // Live-sync: when boss edits app_settings (e.g. sample_seconds), refetch so
  // MusicHUB previews immediately respect the new cap without a page reload.
  useAppSettingsRealtime();

  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<AppSettings> => {
      const signedIn = !!(await supabase.auth.getSession()).data.session;
      const [{ data, error }, extra] = await Promise.all([
        // Only members can read app_settings; visitors get the public values.
        signedIn
          ? supabase.from("app_settings").select("key, value")
          : Promise.resolve({ data: [] as { key: string; value: unknown }[], error: null }),
        // Prices members can't read directly (see public-settings.functions).
        getPublicAppSettings().catch(() => null),
      ]);
      // Signed-out visitors can't read app_settings (only members can), so a
      // refused read isn't an error here: the public server values and the
      // defaults stand in. Throwing made every guest page load retry it.
      if (error && extra == null) throw error;
      const map: Record<string, unknown> = {};
      if (extra?.signup_credits != null) map.signup_credits = extra.signup_credits;
      if (extra?.coins_per_full_unlock != null)
        map.coins_per_full_unlock = extra.coins_per_full_unlock;
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
