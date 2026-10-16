import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  runOnboardingCheck,
  getOnboardingChecks,
  type CheckResult,
} from "@/lib/onboarding-checks.functions";
import { listStripeWebhookEvents } from "@/lib/stripe-events.functions";
import { cn } from "@/lib/utils";

// The connector checklist now lives in Boss → System → Setup checklist.
export const Route = createFileRoute("/_authenticated/admin/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "setup" } });
  },
  component: () => null,
  head: () => ({ meta: [{ title: "Onboarding — Admin | OG BOT — AI Songs & Diss Tracks" }] }),
});

type Step = {
  key: string;
  label: string;
  group: "Core" | "Connectors" | "Payments" | "AI providers" | "OG Bot";
  fixHref?: string;
  fixLabel?: string;
};

const STEPS: Step[] = [
  { key: "lovable_ai", label: "Lovable AI key", group: "Core" },
  {
    key: "telegram",
    label: "Telegram bot (getMe)",
    group: "Connectors",
    fixLabel: "Reconnect Telegram",
  },
  {
    key: "google_drive",
    label: "Google Drive (about)",
    group: "Connectors",
    fixLabel: "Reconnect Drive",
  },
  {
    key: "google_sheets",
    label: "Google Sheets key",
    group: "Connectors",
    fixLabel: "Reconnect Sheets",
  },
  {
    key: "google_search_console",
    label: "Search Console (sites)",
    group: "Connectors",
    fixLabel: "Reconnect GSC",
  },
  { key: "stripe_live", label: "Stripe live key", group: "Payments" },
  { key: "stripe_sandbox", label: "Stripe sandbox key", group: "Payments" },
  { key: "payments_live_webhook", label: "Stripe live webhook secret", group: "Payments" },
  { key: "payments_sandbox_webhook", label: "Stripe sandbox webhook secret", group: "Payments" },
  { key: "gemini", label: "Gemini API key", group: "AI providers" },
  { key: "perplexity", label: "Perplexity API key", group: "AI providers" },
  { key: "suno", label: "Suno API key", group: "AI providers" },
  { key: "og_bot_host", label: "OG Bot host reachable", group: "OG Bot" },
  { key: "og_bot_token", label: "OG_BOT_TOKEN present", group: "OG Bot" },
  { key: "og_bot_mothership", label: "OG_BOT_MOTHERSHIP_URL present", group: "OG Bot" },
  { key: "og_bot_mint_secret", label: "OG_BOT_REMOTE_MINT_SECRET present", group: "OG Bot" },
  { key: "telegram_webhook_secret", label: "TELEGRAM_WEBHOOK_SECRET present", group: "OG Bot" },
];

type Status = "idle" | "running" | "ok" | "fail";

export function OnboardingWizard() {
  const { isAdmin, isLoading } = useRole();
  const runCheck = useServerFn(runOnboardingCheck);
  const loadChecks = useServerFn(getOnboardingChecks);
  const [results, setResults] = useState<
    Record<string, { status: Status; data?: CheckResult; checkedAt?: string }>
  >({});

  const saved = useQuery({
    queryKey: ["onboarding-checks"],
    enabled: isAdmin,
    queryFn: () => loadChecks(),
  });

  useEffect(() => {
    if (!saved.data) return;
    setResults((prev) => {
      const next = { ...prev };
      for (const row of saved.data) {
        if (next[row.key]?.status === "running") continue;
        next[row.key] = {
          status: row.ok ? "ok" : "fail",
          data: { ok: row.ok, detail: row.detail, latencyMs: row.latencyMs },
          checkedAt: row.checked_at,
        };
      }
      return next;
    });
  }, [saved.data]);

  const single = useMutation({
    mutationFn: async (key: string) => {
      setResults((r) => ({ ...r, [key]: { status: "running" } }));
      const data = await runCheck({ data: { key } });
      return { key, data };
    },
    onSuccess: ({ key, data }) => {
      setResults((r) => ({
        ...r,
        [key]: { status: data.ok ? "ok" : "fail", data, checkedAt: new Date().toISOString() },
      }));
    },
    onError: (err, key) => {
      setResults((r) => ({
        ...r,
        [key]: {
          status: "fail",
          data: { ok: false, detail: err instanceof Error ? err.message : "failed" },
        },
      }));
    },
  });

  const runAll = async () => {
    for (const step of STEPS) {
      // sequential so the user can watch progress
      await single.mutateAsync(step.key).catch(() => undefined);
    }
  };

  if (isLoading)
    return (
      <DashboardShell title="Onboarding">
        <div className="p-6 text-muted-foreground">Loading…</div>
      </DashboardShell>
    );
  if (!isAdmin) return <Navigate to="/" />;

  const total = STEPS.length;
  const done = Object.values(results).filter(
    (r) => r.status === "ok" || r.status === "fail",
  ).length;
  const okCount = Object.values(results).filter((r) => r.status === "ok").length;
  const failCount = Object.values(results).filter((r) => r.status === "fail").length;
  const verifiedPct = Math.round((okCount / total) * 100);
  const isReady = okCount === total;
  const statusLabel = isReady
    ? "Ready to generate"
    : failCount > 0
      ? "Needs attention"
      : done === 0
        ? "Not started"
        : "In progress";
  const statusTone = isReady
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
    : failCount > 0
      ? "border-red-500/40 bg-red-500/10 text-red-500"
      : "border-amber-500/40 bg-amber-500/10 text-amber-500";
  const groups = Array.from(new Set(STEPS.map((s) => s.group)));

  return (
    <DashboardShell title="Onboarding">
      <div className="max-w-4xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ShieldCheck className="h-6 w-6 text-primary" />
                Connector onboarding
              </h2>
              <Badge
                variant="outline"
                className={cn("gap-1.5 px-2.5 py-0.5 text-xs font-semibold", statusTone)}
              >
                {isReady ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Loader2 className={cn("h-3.5 w-3.5", done === total ? "" : "animate-spin")} />
                )}
                {statusLabel} · {verifiedPct}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {okCount}/{total} connectors verified. Run each test, fix the red ones, and you're
              done.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runAll} disabled={single.isPending} size="sm">
              {single.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              Run all tests
            </Button>
          </div>
        </header>

        <Card className={cn("p-4", isReady && "border-emerald-500/40 bg-emerald-500/5")}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <span>Onboarding status</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusTone)}>
                {verifiedPct}% verified
              </span>
            </div>
            <span className="text-muted-foreground">
              <span className="text-emerald-500">{okCount} OK</span> ·{" "}
              <span className="text-red-500">{failCount} fail</span> ·{" "}
              <span>{total - done} untested</span>
            </span>
          </div>
          <Progress value={verifiedPct} />
          <div className="mt-2 text-xs text-muted-foreground">
            {isReady
              ? "All connectors verified — you're ready to generate."
              : `${total - okCount} ${total - okCount === 1 ? "check" : "checks"} still needed before you're ready to generate.`}
          </div>
        </Card>

        {groups.map((group) => (
          <Card key={group} className="overflow-hidden">
            <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">{group}</div>
            <ul className="divide-y">
              {STEPS.filter((s) => s.group === group).map((step) => {
                const r = results[step.key];
                const status: Status = r?.status ?? "idle";
                return (
                  <li key={step.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <StatusIcon status={status} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{step.label}</div>
                      {r?.data && (
                        <div
                          className={cn(
                            "truncate text-xs",
                            r.data.ok ? "text-muted-foreground" : "text-red-500",
                          )}
                        >
                          {r.data.detail}
                          {typeof r.data.latencyMs === "number" && (
                            <span className="ml-2 text-muted-foreground">{r.data.latencyMs}ms</span>
                          )}
                          {r.checkedAt && (
                            <span className="ml-2 text-muted-foreground">
                              · {new Date(r.checkedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {status === "fail" && (
                      <Badge variant="destructive" className="hidden sm:inline-flex">
                        Fix
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={status === "fail" ? "default" : "outline"}
                      onClick={() => single.mutate(step.key)}
                      disabled={single.isPending && single.variables === step.key}
                    >
                      {single.isPending && single.variables === step.key ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Test"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        <Card className="p-4 text-sm text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">When a test fails</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Connector rows (Telegram, Google *) → open{" "}
              <span className="font-mono">Connectors</span> in the sidebar and reconnect with the
              same account.
            </li>
            <li>
              Stripe rows → open{" "}
              <Link to="/admin/system" search={{ tab: "webhooks" }} className="underline">
                System → Payments webhook
              </Link>{" "}
              and check Stripe events are arriving.
            </li>
            <li>
              Plain key rows (Gemini / Perplexity / Suno / OG_BOT_*) → Project Settings → Secrets.
            </li>
            <li>
              Full reference list:{" "}
              <a
                className="inline-flex items-center gap-1 underline"
                href="/.lovable/SECRETS.md"
                target="_blank"
                rel="noreferrer"
              >
                SECRETS.md <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          </ul>
        </Card>

        <StripeWebhookViewer />
      </div>
    </DashboardShell>
  );
}

function StripeWebhookViewer() {
  const load = useServerFn(listStripeWebhookEvents);
  const q = useQuery({ queryKey: ["stripe-webhook-events"], queryFn: () => load() });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2 text-sm font-medium">
        <span>Stripe webhook events (last 25)</span>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>
      {q.isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : q.error ? (
        <div className="p-4 text-sm text-red-500">{(q.error as Error).message}</div>
      ) : !q.data || q.data.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No webhook events received yet.</div>
      ) : (
        <ul className="divide-y text-sm">
          {q.data.map((e) => (
            <li key={e.eventId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {e.credited ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{e.eventType}</span>
                  <Badge variant="outline" className="text-[0.7rem] uppercase">
                    {e.environment}
                  </Badge>
                  {e.status && (
                    <Badge variant="secondary" className="text-[0.7rem]">
                      {e.status}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {e.objectId ?? "—"} · {new Date(e.receivedAt).toLocaleString()}
                </div>
                {e.credited ? (
                  <div className="text-xs text-emerald-500">
                    +{e.credited.amount} OG →{" "}
                    {e.credited.userEmail ?? e.credited.userId.slice(0, 8)}
                  </div>
                ) : (
                  <div className="text-xs text-amber-500">
                    No balance update recorded for this event.
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "running")
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === "fail") return <XCircle className="h-5 w-5 text-red-500" />;
  return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
}
