import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { fetchGenerationTerms } from "@/lib/generation-terms";

/**
 * Always-visible line above the Create button so members know where they
 * stand before tapping: free samples left, when samples start costing 2
 * coins, or that they need 5 coins to create. Mirrors the server rules in
 * my_generation_terms / start_generation_charge; the server still decides.
 */
export function CreationAllowance({
  targetMinutes,
  refreshKey,
}: {
  targetMinutes: number;
  refreshKey?: unknown;
}) {
  const { data: t } = useQuery({
    queryKey: ["generation-terms", refreshKey],
    queryFn: fetchGenerationTerms,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!t) {
    return (
      <p className="text-center text-xs font-semibold text-muted-foreground">
        Free to create · {targetMinutes} min
      </p>
    );
  }

  if (t.balance < t.min_balance) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm">
        <p className="font-semibold">
          You need {t.min_balance} OG coins to create · you have {t.balance}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Making songs is free, you just need {t.min_balance} coins in your balance.
        </p>
        <div className="mt-2 flex justify-center gap-2">
          <Link
            to="/buy-coins"
            className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
          >
            Get coins
          </Link>
          <Link
            to="/referrals"
            className="rounded-full border border-border px-3 py-1 text-xs font-bold"
          >
            Earn free
          </Link>
        </div>
      </div>
    );
  }

  if (t.sample_cost > 0) {
    return (
      <p className="mx-auto max-w-md rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-center text-xs font-semibold">
        <Coins className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-amber-300" />
        New samples cost {t.sample_cost} coins · unlock one of your tracks to make them free again
      </p>
    );
  }

  const freeLeft = Math.max(1, t.free_limit - t.unpaid_count);
  return (
    <p className="text-center text-xs font-semibold text-muted-foreground">
      Free to create · {freeLeft} free sample{freeLeft === 1 ? "" : "s"} left · {targetMinutes} min
    </p>
  );
}
