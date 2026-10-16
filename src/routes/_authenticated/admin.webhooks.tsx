import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listStripeWebhookEvents, type StripeEventRow } from "@/lib/stripe-events.functions";
import { useRole } from "@/hooks/use-role";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/webhooks")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "webhooks" } });
  },
  component: () => null,
});

export function WebhooksAdminPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const fetchEvents = useServerFn(listStripeWebhookEvents);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "stripe-webhooks"],
    queryFn: () => fetchEvents({}),
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  if (roleLoading) {
    return (
      <DashboardShell title="Webhook delivery">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <Skeleton className="h-40 w-full" />
        </div>
      </DashboardShell>
    );
  }

  if (!isAdmin) {
    return (
      <DashboardShell title="Webhook delivery">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <p className="text-sm text-muted-foreground">Access denied. Admin only.</p>
        </div>
      </DashboardShell>
    );
  }

  const events: StripeEventRow[] = data ?? [];
  const lastSuccess = events.find((e) => e.credited) ?? null;
  const lastEvent = events[0] ?? null;
  const hasRecent =
    lastEvent && Date.now() - new Date(lastEvent.receivedAt).getTime() < 24 * 60 * 60 * 1000;

  return (
    <DashboardShell title="Webhook delivery">
      <div className="w-full min-w-0 space-y-6">
        <header className="flex items-center gap-3">
          <Activity className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              Live status of incoming Stripe events and the last successful credit.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {hasRecent ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500" />
              )}
              Delivery status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : error ? (
              <p className="text-destructive">Failed to load: {(error as Error).message}</p>
            ) : !lastEvent ? (
              <p className="text-muted-foreground">
                No webhook events received yet. Once Stripe delivers a checkout or subscription
                event, it will appear here.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={hasRecent ? "default" : "secondary"}>
                    {hasRecent ? "Healthy" : "Stale (no events in last 24h)"}
                  </Badge>
                  <Badge variant="outline">{lastEvent.environment}</Badge>
                </div>
                <p className="text-muted-foreground">
                  Last event: <span className="font-mono">{lastEvent.eventType}</span> —{" "}
                  {formatDistanceToNow(new Date(lastEvent.receivedAt), { addSuffix: true })}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last successful event with credit</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {!lastSuccess ? (
              <p className="text-muted-foreground">
                No webhook event has resulted in a confirmed coin credit yet.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge>{lastSuccess.eventType}</Badge>
                  <Badge variant="outline">{lastSuccess.environment}</Badge>
                  {lastSuccess.bundleId && (
                    <Badge variant="secondary">{lastSuccess.bundleId}</Badge>
                  )}
                </div>
                <p>
                  <span className="text-muted-foreground">Credited:</span>{" "}
                  <span className="font-semibold">+{lastSuccess.credited!.amount} coins</span> to{" "}
                  <span className="font-mono">
                    {lastSuccess.credited!.userEmail ?? lastSuccess.credited!.userId}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {formatDistanceToNow(new Date(lastSuccess.receivedAt), { addSuffix: true })}
                  {lastSuccess.objectId ? (
                    <>
                      {" "}
                      · <span className="font-mono text-xs">{lastSuccess.objectId}</span>
                    </>
                  ) : null}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent events (last 25)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {events.map((e) => (
                  <li key={e.eventId} className="flex items-center gap-3 py-2">
                    {e.credited ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{e.eventType}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true })}
                        {" · "}
                        {e.environment}
                        {e.credited ? ` · +${e.credited.amount} coins` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/admin/system"
              search={{ tab: "setup" }}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open setup checklist <ExternalLink className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
