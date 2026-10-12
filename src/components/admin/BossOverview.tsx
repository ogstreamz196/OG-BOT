import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Coins, Crown, Loader2, Music2, RefreshCw, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runApiHealthCheck, type HealthCheck } from "@/lib/api-health.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Live KPI strip: signups, tracks, coins in circulation, VIPs (last 24h where relevant). */
export function BossKpiStrip() {
  const kpis = useQuery({
    queryKey: ["boss-kpis"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const [signups, tracks, failed, vips, balances] = await Promise.all([
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since),
        supabase
          .from("songs")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since),
        supabase
          .from("songs")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed")
          .gte("created_at", since),
        supabase
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("role", "vip"),
        supabase.from("profiles").select("coin_balance").limit(5000),
      ]);
      const coins = (balances.data ?? []).reduce(
        (sum, p: { coin_balance: number }) => sum + Number(p.coin_balance ?? 0),
        0,
      );
      return {
        signups: signups.count ?? 0,
        tracks: tracks.count ?? 0,
        failed: failed.count ?? 0,
        vips: vips.count ?? 0,
        coins,
      };
    },
  });

  const d = kpis.data;
  const cards = [
    { label: "New today", value: d?.signups, Icon: UserPlus, tone: "text-primary" },
    {
      label: "Tracks today",
      value: d?.tracks,
      Icon: Music2,
      tone: "text-primary",
      sub: d && d.failed > 0 ? `${d.failed} failed` : undefined,
    },
    { label: "Coins held", value: d?.coins, Icon: Coins, tone: "text-coin" },
    { label: "VIPs", value: d?.vips, Icon: Crown, tone: "text-coin" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, Icon, tone, sub }) => (
        <div key={label} className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="truncate">{label}:</span>
            <Icon className={cn("h-4 w-4 shrink-0", tone)} />
          </div>
          <div className="mt-1 text-2xl font-normal tabular-nums leading-tight sm:text-3xl">
            {kpis.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              (value ?? 0).toLocaleString()
            )}
          </div>
          {sub && <div className="mt-1 text-xs font-medium text-destructive">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

const PULSE_KEYS = ["gemini", "suno", "perplexity", "og_bot_token"] as const;
const PULSE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  suno: "Suno",
  perplexity: "Perplexity",
  og_bot_token: "Telegram bot",
};

/** Provider status pills powered by the existing admin health check. */
export function ProviderPulse() {
  const run = useServerFn(runApiHealthCheck);
  const report = useQuery({
    queryKey: ["boss-provider-pulse"],
    queryFn: () => run(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const checks = (report.data?.checks ?? []).filter((c: HealthCheck) =>
    (PULSE_KEYS as readonly string[]).includes(c.key),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/70 px-3 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Providers
      </span>
      {report.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {report.isError && <span className="text-xs text-destructive">Couldn't run the check</span>}
      {checks.map((c) => {
        const ok = c.status === "ok";
        const warn = c.status === "degraded";
        return (
          <span
            key={c.key}
            title={c.detail}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              ok && "border-primary/40 bg-primary/10 text-foreground",
              warn && "border-coin/40 bg-coin/10 text-foreground",
              !ok && !warn && "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                ok ? "bg-primary" : warn ? "bg-coin" : "bg-destructive",
              )}
            />
            {PULSE_LABELS[c.key] ?? c.label}
          </span>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-7 px-2"
        disabled={report.isFetching}
        onClick={() => report.refetch()}
        aria-label="Re-check providers"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", report.isFetching && "animate-spin")} />
      </Button>
    </div>
  );
}
