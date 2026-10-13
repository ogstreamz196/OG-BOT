import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText, Loader2, ArrowRight, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  category: string;
  target_key: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

const CAT_STYLES: Record<string, string> = {
  copy: "bg-primary/15 text-primary",
  persona: "bg-accent/30 text-accent-foreground",
  settings: "bg-muted text-muted-foreground",
};

function preview(v: string | null) {
  if (v === null) return <span className="italic text-muted-foreground">∅</span>;
  const s = v.length > 140 ? v.slice(0, 140) + "…" : v;
  return <span className="break-words">{s}</span>;
}

export function BossAuditLog() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["boss-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
        .from("boss_audit_log" as any)
        .select("id, actor_id, action, category, target_key, old_value, new_value, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("boss-audit-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "boss_audit_log" },
        () => {
          qc.invalidateQueries({ queryKey: ["boss-audit-log"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Boss audit log</h3>
        <span className="text-xs text-muted-foreground">— every copy, persona & settings edit</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </Button>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No boss edits recorded yet.
        </p>
      ) : (
        <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {data.map((row) => (
            <li key={row.id}>
              <details className="group rounded-xl border border-border/60 bg-background/40 text-sm open:bg-background/60">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                      CAT_STYLES[row.category] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.category}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {row.action}
                  </span>
                  <code className="rounded bg-muted/60 px-1.5 py-0.5 text-xs">
                    {row.target_key}
                  </code>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <div className="grid gap-2 border-t border-border/40 p-3 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                  <div className="rounded-lg bg-destructive/10 p-2 text-destructive-foreground/80">
                    <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
                      Before
                    </div>
                    {preview(row.old_value)}
                  </div>
                  <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground sm:block" />
                  <div className="rounded-lg bg-primary/10 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">After</div>
                    {preview(row.new_value)}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
