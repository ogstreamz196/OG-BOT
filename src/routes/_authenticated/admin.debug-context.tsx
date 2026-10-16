import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ArrowLeft, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/debug-context")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "tools" } });
  },
  component: () => null,
});

interface DebugRow {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  created_at: string;
  extra_context: string | null;
}

export function DebugContextPage() {
  const { isAdmin, isLoading } = useRole();

  const query = useQuery({
    queryKey: ["admin-debug-context"],
    enabled: isAdmin,
    queryFn: async (): Promise<(DebugRow & { email: string | null })[]> => {
      const { data, error } = await supabase
        .from("songs")
        .select("id, user_id, title, status, created_at, extra_context" as never)
        .not("extra_context", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as unknown as DebugRow[];
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      let emails: Record<string, string | null> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        emails = Object.fromEntries(
          (profiles ?? []).map((p: { id: string; email: string | null }) => [p.id, p.email]),
        );
      }
      return rows.map((r) => ({ ...r, email: emails[r.user_id] ?? null }));
    },
  });

  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), 1500);
    return () => clearTimeout(t);
  }, []);

  if (isLoading || !graceElapsed) {
    return (
      <DashboardShell title="Lyric context debug">
        <div className="grid place-items-center gap-3 py-24 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking admin access…</p>
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) {
    return (
      <DashboardShell title="Access denied">
        <div className="mx-auto grid max-w-md place-items-center gap-3 py-24 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h1 className="font-display text-2xl font-black">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            This area is restricted to admins. If you think this is a mistake, contact an
            administrator.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2 gap-1.5">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
          </Button>
        </div>
      </DashboardShell>
    );
  }

  const rows = query.data ?? [];

  return (
    <DashboardShell title="Lyric context debug">
      <div className="w-full min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            The hidden lyric description members submitted with each song.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {query.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
            No songs with extra context yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.title || "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.email ?? r.user_id.slice(0, 8)} · {new Date(r.created_at).toLocaleString()}{" "}
                      · {r.status}
                    </div>
                  </div>
                  <Link
                    to="/library/$songId"
                    params={{ songId: r.id }}
                    className="text-xs text-primary underline-offset-4 hover:underline"
                  >
                    Open song
                  </Link>
                </div>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/60 p-3 text-xs leading-relaxed text-foreground">
                  {r.extra_context}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
