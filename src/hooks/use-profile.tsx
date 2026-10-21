import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedChannel } from "@/lib/shared-realtime";
import { maskDevIdentity } from "@/lib/dev-identity";
import { useAuth } from "./use-auth";

export function useProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    staleTime: 10_000,
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

  // Realtime so the coin balance updates instantly after generation/purchase.
  // One channel and one refetch per change, however many components use this.
  const uid = user?.id ?? null;
  useSharedChannel(uid ? `profile:${uid}` : null, (ch) =>
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
      () => void qc.invalidateQueries({ queryKey: ["profile", uid] }),
    ),
  );

  return query;
}
