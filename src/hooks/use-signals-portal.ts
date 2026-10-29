import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppSettings } from "@/lib/public-settings.functions";
import { SIGNALS_PORTAL_KEY, useAppSettingsRealtime } from "./app-settings-realtime";

/** True inside the Android/iOS app; null until known (first render, server). */
export function useIsNativeApp(): boolean | null {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => setNative(Capacitor.isNativePlatform()), []);
  return native;
}

/**
 * Whether the OG Signals portal (home card and /signals) is open to members.
 * Stored in app_settings as `signals_portal_enabled`; on unless the Boss has
 * switched it off in Boss → OG Bot → Signals. Never in the phone apps: trading
 * signals stay website-only for Google Play and App Store rules (so it only
 * shows once we know we're not in the app).
 */
export function useSignalsPortal() {
  useAppSettingsRealtime();
  const native = useIsNativeApp();
  const q = useQuery({
    queryKey: SIGNALS_PORTAL_KEY,
    staleTime: 30_000,
    queryFn: async () => (await getPublicAppSettings()).signals_portal_enabled,
  });
  return {
    enabled: native === false && (q.data ?? true),
    isLoading: q.isLoading || native === null,
  };
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
