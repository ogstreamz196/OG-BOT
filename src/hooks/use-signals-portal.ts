import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppSettings } from "@/lib/public-settings.functions";
import { SIGNALS_PORTAL_KEY, useAppSettingsRealtime } from "./app-settings-realtime";

/**
 * Whether the OG Signals portal (home card and /signals) is open to members.
 * Stored in app_settings as `signals_portal_enabled`; on unless the Boss has
 * switched it off in Boss → OG Bot → Signals.
 */
export function useSignalsPortal() {
  useAppSettingsRealtime();
  const q = useQuery({
    queryKey: SIGNALS_PORTAL_KEY,
    staleTime: 30_000,
    queryFn: async () => (await getPublicAppSettings()).signals_portal_enabled,
  });
  return { enabled: q.data ?? true, isLoading: q.isLoading };
}

export function useSetSignalsPortal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert([{ key: "signals_portal_enabled", value: enabled as unknown as never }], {
          onConflict: "key",
        });
      if (error) throw new Error(error.message);
      return enabled;
    },
    onSuccess: (enabled) => {
      qc.setQueryData(SIGNALS_PORTAL_KEY, enabled);
      toast.success(enabled ? "OG Signals is open to members" : "OG Signals is switched off");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
