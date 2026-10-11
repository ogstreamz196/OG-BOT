import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runApiHealthCheck, type HealthCheck } from "@/lib/api-health.functions";

export const Route = createFileRoute("/_authenticated/admin/health")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system" });
  },
  component: () => null,
  head: () => ({
    meta: [
      { title: "API health — OG Streamz Admin" },
      {
        name: "description",
        content: "Automated backend health check for the Gemini, Suno, Perplexity and OG Bot keys.",
      },
      { property: "og:title", content: "API health — OG Streamz Admin" },
      {
        property: "og:description",
        content: "Verify every required API key and see actionable fixes for anything broken.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function statusIcon(status: HealthCheck["status"]) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (status === "degraded") return <AlertTriangle className="h-5 w-5 text-amber-400" />;
  return <XCircle className="h-5 w-5 text-destructive" />;
}

export function ApiHealthPage() {
  const { isAdmin, isLoading } = useRole();
  const run = useServerFn(runApiHealthCheck);

  // Automated: runs on mount, then every 5 minutes while the page is open.
  const report = useQuery({
    queryKey: ["api-health"],
    enabled: isAdmin,
    queryFn: () => run(),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <DashboardShell title="API health">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const data = report.data;
  const groups = ["Core", "AI providers", "OG Bot"] as const;

  return (
    <DashboardShell title="API health">
      <div className="space-y-5">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.16em]">
              {report.isFetching
                ? "Checking every key…"
                : data
                  ? data.healthy
                    ? "All required keys healthy"
                    : `${data.failCount} key${data.failCount === 1 ? "" : "s"} need attention`
                  : "Not checked yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.okCount}/${data.checks.length} passing · last checked ${new Date(data.checkedAt).toLocaleTimeString()} · auto re-runs every 5 min`
                : "Verifies GEMINI, SUNO, PERPLEXITY and OG_BOT_* by calling each provider."}
            </p>
          </div>
          <Button
            onClick={() => report.refetch()}
            disabled={report.isFetching}
            variant="outline"
            className="gap-2"
          >
            {report.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Re-run now
          </Button>
        </Card>

        {report.isError && (
          <Card className="border-destructive/40 p-4 text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Health check failed"}
          </Card>
        )}

        {groups.map((group) => {
          const items = (data?.checks ?? []).filter((c) => c.group === group);
          if (!items.length) return null;
          return (
            <section key={group} className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-[0.22em] text-muted-foreground">
                {group}
              </h2>
              <div className="space-y-2">
                {items.map((c) => (
                  <Card key={c.key} className="flex items-start gap-3 p-4">
                    <span className="mt-0.5 shrink-0">{statusIcon(c.status)}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{c.label}</p>
                        <Badge variant={c.status === "ok" ? "secondary" : "destructive"}>
                          {c.status}
                        </Badge>
                        {c.latencyMs != null && (
                          <span className="text-xs text-muted-foreground">
                            {c.latencyMs} ms
                          </span>
                        )}
                      </div>
                      <p className="break-words text-sm text-muted-foreground">{c.detail}</p>
                      {c.status !== "ok" && c.fix && (
                        <p className="break-words text-sm font-medium text-amber-300">
                          Fix: {c.fix}
                        </p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </DashboardShell>
  );
}
