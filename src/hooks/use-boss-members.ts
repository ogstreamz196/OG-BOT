import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBossMembers, type BossMember } from "@/lib/admin-members.functions";
import { maskDevIdentity } from "@/lib/dev-identity";

/**
 * Every member, for the Members list and the Boss search. One cache entry, so
 * the search reuses the list (and the other way round) instead of fetching twice.
 */
export function useBossMembers(enabled: boolean) {
  const fetchMembers = useServerFn(listBossMembers);
  return useQuery({
    queryKey: ["admin-users-list"],
    enabled,
    queryFn: async (): Promise<BossMember[]> => {
      const { members } = await fetchMembers();
      return members.map((m) => maskDevIdentity(m));
    },
    staleTime: 30_000,
  });
}
