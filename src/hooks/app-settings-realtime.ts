import { useQueryClient } from "@tanstack/react-query";
import { useSharedChannel } from "@/lib/shared-realtime";

export const SETTINGS_QUERY_KEY = ["app-settings"] as const;
export const FREE_ACCESS_KEY = ["app-setting", "free_access_all"] as const;
export const SIGNALS_PORTAL_KEY = ["app-setting", "signals_portal_enabled"] as const;

/**
 * Live app_settings for the whole page: one channel shared by every
 * useSettings / useFreeAccess caller, refreshing each query once per change
 * (e.g. the boss edits sample_seconds or turns free access on).
 */
export function useAppSettingsRealtime() {
  const qc = useQueryClient();
  useSharedChannel("app-settings", (ch) =>
    ch.on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: FREE_ACCESS_KEY });
      void qc.invalidateQueries({ queryKey: SIGNALS_PORTAL_KEY });
    }),
  );
}
