import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Global "free access for everyone" flag, stored in app_settings.
 * Dev/admin can toggle it from the developer dashboard. When ON, all
 * signed-in users get VIP-only features (incl. OG Bot foul-mouth mode).
 *
 * Optionally an expiry timestamp (`free_access_expires_at`, ISO string)
 * automatically reverts access back to VIP-only after the set time.
 */
export const FREE_ACCESS_KEY = ["app-setting", "free_access_all"] as const;

type FreeAccessRow = {
  rawEnabled: boolean;
  expiresAt: string | null;
};

export function useFreeAccess() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: FREE_ACCESS_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<FreeAccessRow> => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return { rawEnabled: false, expiresAt: null };
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["free_access_all", "free_access_expires_at"]);
      if (error) return { rawEnabled: false, expiresAt: null };
      const map = new Map((data ?? []).map((r) => [r.key, r.value as unknown]));
      const v = map.get("free_access_all");
      const exp = map.get("free_access_expires_at");
      return {
        rawEnabled: v === true || v === "true",
        expiresAt: typeof exp === "string" && exp ? exp : null,
      };
    },
  });

  // Tick every 30s so the expiry flips the UI without a manual refresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const channel = supabase.channel(
      `app-settings-free:${Math.random().toString(36).slice(2, 10)}`,
    );
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings", filter: "key=eq.free_access_all" },
        () => qc.invalidateQueries({ queryKey: FREE_ACCESS_KEY }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.free_access_expires_at",
        },
        () => qc.invalidateQueries({ queryKey: FREE_ACCESS_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const row = query.data ?? { rawEnabled: false, expiresAt: null };
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
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: "free_access_all", value: next.enabled as unknown as never },
          { onConflict: "key" },
        );
      if (error) throw new Error(error.message);
      // Always upsert the expiry key (null clears it).
      const expValue = (next.expiresAt ?? null) as unknown as never;
      const { error: e2 } = await supabase
        .from("app_settings")
        .upsert({ key: "free_access_expires_at", value: expValue }, { onConflict: "key" });
      if (e2) throw new Error(e2.message);
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
