import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppSettings } from "@/lib/public-settings.functions";
import { FREE_ACCESS_KEY, useAppSettingsRealtime } from "./app-settings-realtime";
import { toast } from "sonner";

/**
 * Global "free access for everyone" flag, stored in app_settings.
 * Dev/admin can toggle it from the developer dashboard. When ON, all
 * signed-in users get VIP-only features (incl. OG Bot foul-mouth mode).
 *
 * Optionally an expiry timestamp (`free_access_expires_at`, ISO string)
 * automatically reverts access back to VIP-only after the set time.
 */
export { FREE_ACCESS_KEY };

type FreeAccessRow = {
  rawEnabled: boolean;
  expiresAt: string | null;
};

export function useFreeAccess() {
  const query = useQuery({
    queryKey: FREE_ACCESS_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<FreeAccessRow> => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return { rawEnabled: false, expiresAt: null };
      // Read through the server: members' browsers can't read the end date
      // directly, which left free access on after it should have ended.
      const pub = await getPublicAppSettings().catch(() => null);
      if (!pub) return { rawEnabled: false, expiresAt: null };
      return { rawEnabled: pub.free_access_all, expiresAt: pub.free_access_expires_at };
    },
  });

  useAppSettingsRealtime();

  const row = query.data ?? { rawEnabled: false, expiresAt: null };

  // Re-render the moment free access expires (one timer, not a 30s tick).
  const [, setExpiredTick] = useState(0);
  useEffect(() => {
    if (!row.expiresAt) return;
    const ms = new Date(row.expiresAt).getTime() - Date.now();
    if (!(ms > 0)) return;
    const id = setTimeout(() => setExpiredTick((n) => n + 1), Math.min(ms + 250, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [row.expiresAt]);
  const expired = !!row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now();
  const enabled = row.rawEnabled && !expired;

  return {
    enabled,
    rawEnabled: row.rawEnabled,
    expiresAt: row.expiresAt,
    expired,
    isLoading: query.isLoading,
  };
}

export function useSetFreeAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: { enabled: boolean; expiresAt?: string | null }) => {
      // One statement for both keys, so a save never half-applies.
      const { error } = await supabase.from("app_settings").upsert(
        [
          { key: "free_access_all", value: next.enabled as unknown as never },
          { key: "free_access_expires_at", value: (next.expiresAt ?? null) as unknown as never },
        ],
        { onConflict: "key" },
      );
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(FREE_ACCESS_KEY, {
        rawEnabled: next.enabled,
        expiresAt: next.expiresAt ?? null,
      } satisfies FreeAccessRow);
      qc.invalidateQueries({ queryKey: ["user-role"] });
      if (next.enabled) {
        toast.success(
          next.expiresAt
            ? `Free access ON — auto-off ${new Date(next.expiresAt).toLocaleString()}`
            : "Free access ON for all users",
        );
      } else {
        toast.success("Free access OFF — VIP-only restored");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
