import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  user_id: string;
  song_id: string | null;
  title: string | null;
  stage: string;
  status: string;
  error_message: string | null;
  context: Record<string, unknown>;
  created_at: string;
};

/** Boss-only list of every creation attempt, newest first, with the exact failure reason. */
export function GenerationFailures() {
  const q = useQuery({
    queryKey: ["admin-generation-attempts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generation_attempts" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      const ids = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, display_name, email").in("id", ids)
        : { data: [] };
      const names = Object.fromEntries(
        (profs ?? []).map((p) => [p.id, p.display_name || p.email || p.id.slice(0, 8)]),
      );
      return rows.map((r) => ({ ...r, who: names[r.user_id] ?? r.user_id.slice(0, 8) }));
    },
  });
  const rows = q.data ?? [];
  const failed = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} recent attempts · <span className="text-destructive">{failed} failed</span>
        </p>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {q.isLoading ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
          No attempts logged yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-card/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{r.title || "Untitled"}</span>
                <span
                  className={
                    r.status === "failed"
                      ? "text-destructive"
                      : r.status === "succeeded"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }
                >
                  {r.status} · {r.stage}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {r.who} · {new Date(r.created_at).toLocaleString()}
                {r.song_id && (
                  <>
                    {" · "}
                    <Link to="/library/$songId" params={{ songId: r.song_id }} className="underline">
                      track
                    </Link>
                  </>
                )}
              </div>
              {r.error_message && (
                <p className="mt-2 break-words rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                  {r.error_message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
