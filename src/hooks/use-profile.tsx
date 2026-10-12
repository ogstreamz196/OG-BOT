import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { maskDevIdentity } from "@/lib/dev-identity";
import { useAuth } from "./use-auth";

export function useProfile() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    staleTime: 10_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, coin_balance, og_vip_id, vip_trial_ends_at")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return maskDevIdentity(data);
    },
  });

  // Realtime subscription so the coin balance updates instantly after generation/purchase.
  useEffect(() => {
    if (!user) return;
    const channelName = `profile:${user.id}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        () => query.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return query;
}
