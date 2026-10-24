import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { pingOgBot } from "@/lib/og-bot-status.functions";
import { AdminSection } from "./AdminSection";
import { cn } from "@/lib/utils";

export function OgBotPing() {
  const ping = useServerFn(pingOgBot);
  const q = useQuery({
    queryKey: ["og-bot-host-ping"],
    queryFn: () => ping(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const status = q.data;
  const ok = !!status?.ok;
  const loading = q.isLoading;
  const tone = loading
    ? "bg-muted text-muted-foreground"
    : ok
      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
      : "bg-destructive/15 text-destructive ring-1 ring-destructive/30";

  const subtitle = (
    <>
      {status?.host ?? "OG_BOT_HOST not configured"}
      {typeof status?.latencyMs === "number" && ` · ${status.latencyMs}ms`}
      {status && !status.ok && status.error ? ` · ${status.error}` : null}
    </>
  );

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}
      {loading
        ? "Checking…"
        : ok
          ? `Online (${status?.status ?? 200})`
          : `Offline${status?.status ? ` (${status.status})` : ""}`}
    </span>
  );

  return (
    <AdminSection
      padding="p-4"
      icon={<Activity className="h-5 w-5 text-primary" />}
      title="0G B0T host"
      subtitle={subtitle}
      action={badge}
    >
      {null}
    </AdminSection>
  );
}
