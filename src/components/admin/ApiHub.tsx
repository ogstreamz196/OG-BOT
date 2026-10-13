import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Copy, Loader2, RefreshCw, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  pingApiKey,
  runApiHealthCheck,
  type HealthCheck,
  type HealthGroup,
  type HealthReport,
} from "@/lib/api-health.functions";
import { LedgerlyPanel } from "./LedgerlyPanel";
import { VaultWebhookPanel } from "./VaultWebhookPanel";

const GROUPS: HealthGroup[] = ["AI chat & lyrics", "Music", "Payments", "Telegram", "Google", "Bot hosting", "Core"];

function StatusBadge({ status }: { status: HealthCheck["status"] }) {
  if (status === "ok")
    return <Badge className="gap-1 bg-primary/15 text-primary"><CheckCircle2 className="h-3.5 w-3.5" />Working</Badge>;
  if (status === "missing")
    return <Badge variant="outline" className="gap-1"><XCircle className="h-3.5 w-3.5" />Missing</Badge>;
  return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />Needs attention</Badge>;
}

function KeyCard({ check, onPinged }: { check: HealthCheck; onPinged: (c: HealthCheck) => void }) {
  const ping = useServerFn(pingApiKey);
  const [busy, setBusy] = useState(false);
  const doPing = async () => {
    setBusy(true);
    try {
      const r = await ping({ data: { key: check.key } });
      onPinged(r);
      r.status === "ok" ? toast.success(`${r.label}: ${r.detail}`) : toast.error(`${r.label}: ${r.detail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ping failed");
    } finally {
      setBusy(false);
    }
  };
  const replace = () => {
    if (!check.secret) return;
    const phrase = `Replace my ${check.secret}`;
    void navigator.clipboard?.writeText(phrase).catch(() => {});
    toast.success(`Copied "${phrase}" — paste it in the Lovable chat to open the secure key form.`);
  };
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">{check.label}</p>
          {check.secret && <p className="truncate font-mono text-[11px] text-muted-foreground">{check.secret}</p>}
        </div>
        <StatusBadge status={check.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {check.detail}
        {typeof check.latencyMs === "number" && <> · {check.latencyMs} ms</>}
      </p>
      {check.status !== "ok" && check.fix && <p className="text-xs text-destructive">{check.fix}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={doPing} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Ping
        </Button>
        {check.secret && (
          <Button size="sm" variant="ghost" onClick={replace} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />Replace key
          </Button>
        )}
        {check.help && (
          <a href={`https://${check.help}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
            Get a key
          </a>
        )}
      </div>
    </Card>
  );
}

export function ApiHub() {
  const qc = useQueryClient();
  const run = useServerFn(runApiHealthCheck);
  const report = useQuery({
    queryKey: ["api-health"],
    queryFn: () => run(),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const onPinged = (c: HealthCheck) =>
    qc.setQueryData<HealthReport>(["api-health"], (old) => {
      if (!old) return old;
      const checks = old.checks.map((x) => (x.key === c.key ? c : x));
      const failCount = checks.filter((x) => x.status !== "ok").length;
      return { ...old, checks, failCount, okCount: checks.length - failCount };
    });
  const d = report.data;

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em]">
            {report.isFetching ? "Pinging every key…" : d ? `${d.okCount}/${d.checks.length} keys working` : "Not checked yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            Keys are stored encrypted and never shown here. {d && `Last checked ${new Date(d.checkedAt).toLocaleTimeString()}.`}
          </p>
        </div>
        <Button onClick={() => report.refetch()} disabled={report.isFetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${report.isFetching ? "animate-spin" : ""}`} />Ping all
        </Button>
      </Card>

      {report.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {report.error && <p className="text-sm text-destructive">{(report.error as Error).message}</p>}

      {d &&
        GROUPS.map((g) => {
          const items = d.checks.filter((c) => c.group === g);
          if (!items.length) return null;
          return (
            <section key={g} className="space-y-3">
              <h2 className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((c) => <KeyCard key={c.key} check={c} onPinged={onPinged} />)}
              </div>
              {g === "Payments" && (<><LedgerlyPanel /><VaultWebhookPanel /></>)}
            </section>
          );
        })}
    </div>
  );
}
