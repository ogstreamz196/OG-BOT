import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  Stethoscope,
  XCircle,
} from "lucide-react";
import {
  runTelegramSmokeTest,
  type TelegramSmokeResult,
} from "@/lib/telegram-smoke-test.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function TelegramSmokeTest() {
  const runFn = useServerFn(runTelegramSmokeTest);
  const m = useMutation<TelegramSmokeResult, Error, void>({
    mutationFn: () => runFn(),
    onSuccess: (r) =>
      r.ok
        ? toast.success("Telegram smoke test passed")
        : toast.error("Telegram smoke test found issues"),
    onError: (e) => toast.error(e.message),
  });

  const data = m.data;
  const running = m.isPending;
  const tone = !data
    ? "bg-muted text-muted-foreground"
    : data.ok
      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
      : "bg-destructive/15 text-destructive ring-1 ring-destructive/30";
  const label = running
    ? "Running…"
    : !data
      ? "Not yet run"
      : data.ok
        ? "All checks passed"
        : "Issues detected";

  return (
    <section
      aria-label="Telegram webhook smoke test"
      className="rounded-2xl border-2 border-border/40 bg-card/60 p-4 backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <Stethoscope className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase tracking-[0.18em]">Webhook smoke test</p>
          <p className="text-xs text-muted-foreground">
            Runs <span className="font-mono">getMe</span> +{" "}
            <span className="font-mono">getWebhookInfo</span> through the connector gateway.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            tone,
          )}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : !data ? null : data.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {label}
        </span>
        <Button size="sm" onClick={() => m.mutate()} disabled={running} className="gap-1.5">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Run smoke test
        </Button>
      </div>

      {data ? (
        <div className="mt-3 space-y-2">
          {data.steps.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs"
            >
              {s.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="break-words text-muted-foreground">{s.detail}</p>
                {s.url ? (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {s.url}
                  </p>
                ) : null}
              </div>
              {s.latencyMs > 0 ? (
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.latencyMs}ms
                </span>
              ) : null}
            </div>
          ))}
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Ran {new Date(data.ranAt).toLocaleTimeString()} · {data.totalMs}ms total
          </p>
        </div>
      ) : null}
    </section>
  );
}
