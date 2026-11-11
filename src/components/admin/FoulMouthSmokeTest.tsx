import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
  Clock,
  SkipForward,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { runFoulMouthSmokeTest, type FoulSmokeResult } from "@/lib/foul-mouth-smoke-test.functions";

/**
 * One-click smoke test for the Live Chat foul-mouth toggle:
 * verifies server-side VIP gating, prompt swap, and reply quality.
 */
export function FoulMouthSmokeTest() {
  const runFn = useServerFn(runFoulMouthSmokeTest);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FoulSmokeResult | null>(null);

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = (await runFn({} as never)) as FoulSmokeResult;
      setResult(r);
      if (r.ok) toast.success("Foul-mouth smoke test passed");
      else toast.error("Foul-mouth smoke test had failures");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Smoke test crashed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="og-panel rounded-xl border border-white/10 bg-card/60 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Flame className="h-4 w-4 text-orange-400" /> Live Chat foul-mouth smoke test
          </h3>
          <p className="text-xs text-muted-foreground">
            Verifies safe-prompt path, server-side VIP gating, and brutal-short-but-helpful reply
            quality.
          </p>
        </div>
        <Button onClick={onRun} disabled={running} className="gap-2">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          {running ? "Running…" : "Run test"}
        </Button>
      </div>

      {result && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Caller VIP: <span className="font-semibold">{result.isVip ? "yes" : "no"}</span>
          </p>
          {result.steps.map((s) => {
            const Icon =
              s.status === "ok"
                ? CheckCircle2
                : s.status === "fail"
                  ? XCircle
                  : s.status === "skip"
                    ? SkipForward
                    : Clock;
            const color =
              s.status === "ok"
                ? "text-emerald-400"
                : s.status === "fail"
                  ? "text-red-400"
                  : s.status === "skip"
                    ? "text-muted-foreground"
                    : "text-amber-400";
            return (
              <div
                key={s.id}
                className="flex items-start gap-3 rounded-lg border border-white/5 bg-background/40 p-3"
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{s.ms}ms</span>
                  </div>
                  {s.detail && (
                    <p className="mt-1 break-words text-xs text-muted-foreground">{s.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">
            Finished {new Date(result.finishedAt).toLocaleTimeString()} ·{" "}
            {result.ok ? "All steps passed" : "One or more steps failed"}
          </p>
        </div>
      )}
    </div>
  );
}
