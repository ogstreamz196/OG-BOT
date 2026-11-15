import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRole } from "@/hooks/use-role";
import { getVipPassStatus } from "@/lib/vip-pass.functions";
import { memberBadge, type MemberBadge } from "@/lib/member-badge";

/**
 * The signed-in member's own badge: REAL OG with both PRO (the paid "vip"
 * role, not the free trial) and a Vault pass they own, else PRO, else null.
 * Shares the Vault pass card's query, so it costs no extra request there.
 */
export function useMemberBadge(): MemberBadge | null {
  const { hasVipRole } = useRole();
  const statusFn = useServerFn(getVipPassStatus);
  const pass = useQuery({
    queryKey: ["vip-pass-status"],
    queryFn: () => statusFn(),
    enabled: hasVipRole,
    staleTime: 5 * 60_000,
  });
  return memberBadge({ pro: hasVipRole, vaultPass: !!pass.data?.purchased });
}
