import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getWebhookChecks, runWebhookCheck } from "@/lib/webhook-keeper.functions";
import { cn } from "@/lib/utils";
import { AdminSection } from "./AdminSection";

const KEY = ["webhook-checks"];

/**
 * Boss → Signals → Bots: every bot's Telegram connection. Checked every 15
 * minutes and put right by itself when it slips (webhook-keeper.server.ts).
 */
export function WebhookKeeperPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getWebhookChecks);
  const run = useServerFn(runWebhookCheck);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const checking = useMutation({
    mutationFn: () => run(),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r);
      const down = r.checks.filter((c) => !c.ok).length;
      const fixed = r.checks.filter((c) => c.fixed).length;
      if (down) toast.error(`${down} bot${down === 1 ? "" : "s"} still not connected`);
      else
        toast.success(
          fixed ? `All connected (${fixed} reconnected just now)` : "All bots connected",
        );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Check failed"),
  });

  return (
    <AdminSection
      icon={<Plug className="h-4 w-4 text-emerald-400" />}
      title="Bot connections"
      subtitle="Every bot's Telegram connection is checked every 15 minutes and reconnected by itself if it slips. Messages waiting while it was down are kept."
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3 text-sm">
          {data?.checks.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {data.checks.map((c) => (
                <li key={c.bot} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-semibold text-foreground">{c.bot}</span>
                  <span
                    className={cn(
                      "text-xs",
                      c.ok ? (c.fixed ? "text-amber-300" : "text-emerald-400") : "text-rose-400",
                    )}
                  >
                    {c.ok
                      ? c.fixed
                        ? `Reconnected (${c.problem})`
                        : "Connected"
                      : `Not connected: ${c.problem}`}
                  </span>
                  {c.pending > 0 && (
                    <span className="text-xs text-muted-foreground">· {c.pending} waiting</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Not checked yet. The first check runs within 15 minutes.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={checking.isPending} onClick={() => checking.mutate()}>
              {checking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check now"}
            </Button>
            {data?.at && (
              <span className="text-xs text-muted-foreground">
                Last checked {new Date(data.at).toLocaleString("en-GB")}
              </span>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
