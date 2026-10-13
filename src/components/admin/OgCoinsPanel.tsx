import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const DAILY_LIMIT = 100;
const REFERENCE = "og_free_mint";

export function OgCoinsPanel() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const usedQ = useQuery({
    queryKey: ["og-free-mint-used", user?.id, todayStart],
    enabled: !!user && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("amount")
        .eq("user_id", user!.id)
        .eq("reference", REFERENCE)
        .gte("created_at", todayStart);
      if (error) throw error;
      return (data ?? []).reduce(
        (sum, r: { amount: number }) => sum + (r.amount > 0 ? r.amount : 0),
        0,
      );
    },
  });

  const used = usedQ.data ?? 0;
  const remaining = Math.max(0, DAILY_LIMIT - used);

  const mint = useMutation({
    mutationFn: async (amount: number) => {
      if (!user) throw new Error("Not signed in");
      const capped = Math.min(amount, remaining);
      if (capped <= 0) throw new Error("Daily free-mint limit reached");
      const { error } = await supabase.rpc("mint_coins_admin", {
        target_user_id: user.id,
        amount: capped,
        admin_notes: REFERENCE,
      });
      if (error) throw error;
      return capped;
    },
    onSuccess: (capped) => {
      toast.success(`Minted ${capped} OG coins`);
      qc.invalidateQueries({ queryKey: ["og-free-mint-used"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  const quick = [10, 25, 50, 100];

  return (
    <div className="mb-6 rounded-2xl border border-primary/40 bg-gradient-brand-soft p-5 shadow-glow">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-brand shadow-glow">
          <Sparkles className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">OG Coins — Boss free mint</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <ShieldCheck className="h-3 w-3" /> Boss eyes only
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            You still pay coins to test like every user — this gives you {DAILY_LIMIT} free coins
            per day to mint for yourself.
          </p>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2.5 py-1">
              <Coins className="h-3.5 w-3.5 text-coin" />
              <span className="font-semibold tabular-nums">{remaining}</span>
              <span className="text-muted-foreground">/ {DAILY_LIMIT} left today</span>
            </span>
            {usedQ.isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {quick.map((n) => (
          <Button
            key={n}
            size="sm"
            disabled={mint.isPending || remaining <= 0 || n > remaining}
            onClick={() => mint.mutate(n)}
            className="bg-gradient-brand text-primary-foreground"
          >
            {mint.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Coins className="mr-1.5 h-3.5 w-3.5" />
            )}
            +{n}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={mint.isPending || remaining <= 0}
          onClick={() => mint.mutate(remaining)}
        >
          Mint remaining ({remaining})
        </Button>
      </div>
    </div>
  );
}
