import { useQuery } from "@tanstack/react-query";
import { History, Loader2, RefreshCw, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import { cn } from "@/lib/utils";

interface Tx {
  id: string;
  amount: number;
  type: string;
  reference: string | null;
  created_at: string;
}

export function UserAuditTrail({ userId, email }: { userId: string; email?: string | null }) {
  const q = useQuery({
    queryKey: ["admin-user-audit", userId],
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("id, amount, type, reference, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  const lastSync = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString() : "—";
  const latestTx = q.data?.[0];

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Audit trail · {email ?? userId.slice(0, 8)}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Last sync {lastSync}
          {latestTx && <> · last change {new Date(latestTx.created_at).toLocaleString()}</>}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          title="Refresh"
          aria-label="Refresh audit trail"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />
        </Button>
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : q.data && q.data.length > 0 ? (
        <CollapsiblePanel title="Recent changes" count={q.data.length}>
          <ul className="divide-y divide-border text-sm max-h-96 overflow-y-auto">
            {q.data.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-3 py-2">
                <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted">
                  <Coins className="h-3 w-3 text-coin" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.type}
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        t.amount > 0 && "text-primary",
                        t.amount < 0 && "text-destructive",
                        t.amount === 0 && "text-muted-foreground",
                      )}
                    >
                      {t.amount > 0 ? "+" : ""}
                      {t.amount}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString()}
                    </span>
                  </div>
                  {t.reference && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.reference}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      ) : (
        <p className="text-sm text-muted-foreground">No activity on this account yet.</p>
      )}
    </div>
  );
}
