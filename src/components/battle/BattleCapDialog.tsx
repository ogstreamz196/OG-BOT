import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function untilMidnightUtc(now = Date.now()): string {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}h ${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
}

export function BattleCapDialog({
  open,
  onOpenChange,
  purse,
  onWithdraw,
  withdrawing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purse: string;
  onWithdraw: () => void;
  withdrawing?: boolean;
}) {
  const [left, setLeft] = useState(untilMidnightUtc());
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setLeft(untilMidnightUtc()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-primary/40 text-center">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">🏆 Pot's stacked!</DialogTitle>
          <DialogDescription className="text-center text-foreground/80">
            You battered OG Bot and built your bank to <strong>{purse}</strong>. Cash it into your
            balance now, or let the pot keep building.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Fresh coins start dropping again in
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{left}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={onWithdraw} disabled={withdrawing}>
            {withdrawing ? "Banking…" : "Withdraw into balance"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep building the pot
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
