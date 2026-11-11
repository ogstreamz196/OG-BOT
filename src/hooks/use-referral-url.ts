import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const SITE = "https://ogbot.co.uk";

/**
 * The signed-in user's personal invite link, used to stamp shareable
 * artwork so every share feeds the referral loop.
 */
export function useReferralUrl(): string {
  const { user } = useAuth();
  const { data: code } = useQuery({
    queryKey: ["my-referral-code", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.referral_code as string | null) ?? null;
    },
  });
  const origin = SITE;
  return code ? `${origin}/r/${code.replace(/^OG-/, "")}` : origin;
}
