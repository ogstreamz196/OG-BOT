import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, RotateCcw, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getSignalRecord, resetSignalRecordFn } from "@/lib/signal-record.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["signal-record"];

/** Boss: the 70%+ signal record, which only resets when this button is pressed. */
export function SignalRecordPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getSignalRecord);
  const reset = useServerFn(resetSignalRecordFn);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const r = data?.record ?? null;

  async function doReset() {
    setBusy(true);
    try {
      await reset();
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success("Signal record reset. Counting from now.");
    } catch {
      toast.error("Couldn't reset the record");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const since = r?.since
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(r.since))
    : "the start";

  return (
    <AdminSection
      icon={<Trophy className="h-4 w-4 text-amber-400" />}
      title="Signal record & win rate"
      subtitle="Every gold and bitcoin signal sent at 70% confidence or more (members only see the win rate), and how they did. It never resets by itself, only with this button."
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={busy || isLoading}
          onClick={() => setConfirm(true)}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      }
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : !r ? (
        <p className="text-sm text-muted-foreground">Couldn't read the record right now.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Counting since {since}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border p-3">
              <div className="text-2xl font-black text-foreground">{r.signals}</div>
              <div className="text-xs text-muted-foreground">signals</div>
            </div>
            <div className="rounded-xl border border-emerald-500/40 p-3">
              <div className="text-2xl font-black text-emerald-400">{r.wins}</div>
              <div className="text-xs text-muted-foreground">won</div>
            </div>
            <div className="rounded-xl border border-rose-500/40 p-3">
              <div className="text-2xl font-black text-rose-400">{r.losses}</div>
              <div className="text-xs text-muted-foreground">lost</div>
            </div>
          </div>
          <p className="text-muted-foreground">
            {r.wins + r.losses
              ? `${Math.round((r.wins / (r.wins + r.losses)) * 100)}% win rate · `
              : ""}
            {r.running} running · {r.cancelled} cancelled orders
          </p>
          {r.markets.map((m) => (
            <p key={m.label} className={m.pips >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {m.label}: {m.pips >= 0 ? "+" : "−"}
              {Math.abs(m.pips).toFixed(1)} {m.unit}
            </p>
          ))}
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the signal record?</AlertDialogTitle>
            <AlertDialogDescription>
              The counter starts again from zero, now. Old signals and results stay in the results
              book; they just stop counting here and on the signals chat scoreboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void doReset()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminSection>
  );
}
