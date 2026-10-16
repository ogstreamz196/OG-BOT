import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Scale, ShieldCheck } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  auditCoinBalances,
  reconcileUserCoinBalance,
  type CoinDiscrepancy,
} from "@/lib/coin-audit.functions";

export const Route = createFileRoute("/_authenticated/admin/coin-audit")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coins", search: { tab: "coin-check" } });
  },
  component: () => null,
});

export function CoinAuditPage() {
  const audit = useServerFn(auditCoinBalances);
  const reconcile = useServerFn(reconcileUserCoinBalance);
  const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<CoinDiscrepancy[] | null>(null);
  const [checked, setChecked] = useState(0);

  const runAll = useMutation({
    mutationFn: async () => audit({ data: {} }),
    onSuccess: (res) => {
      if ("error" in res) return toast.error(res.error);
      setRows(res.discrepancies);
      setChecked(res.checked);
      toast.success(`Audited ${res.checked} users — ${res.discrepancies.length} discrepancies`);
    },
  });

  const runOne = useMutation({
    mutationFn: async () => audit({ data: { userId: userId.trim() } }),
    onSuccess: (res) => {
      if ("error" in res) return toast.error(res.error);
      setRows(res.discrepancies);
      setChecked(res.checked);
      if (res.discrepancies.length === 0) toast.success("Balance matches ledger ✓");
    },
  });

  const fix = useMutation({
    mutationFn: async (uid: string) => reconcile({ data: { userId: uid } }),
    onSuccess: (res) => {
      if ("error" in res) return toast.error(res.error);
      toast.success(
        res.delta === 0
          ? "Already balanced"
          : `Corrected ${res.user_id.slice(0, 8)}: ${res.previous} → ${res.corrected} (Δ${res.delta > 0 ? "+" : ""}${res.delta})`,
      );
      // refresh visible list
      if (rows) setRows(rows.filter((r) => r.user_id !== res.user_id));
    },
  });

  const busy = runAll.isPending || runOne.isPending;

  return (
    <DashboardShell title="Coin Balance Audit">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Verify balances against ledger</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Compares <code>profiles.coin_balance</code> with the sum of every row in
            <code> coin_transactions</code>. Any mismatch is a missing or lost increment.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label htmlFor="uid" className="text-xs">
                Check a single user (UUID)
              </Label>
              <Input
                id="uid"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={() => runOne.mutate()} disabled={!userId.trim() || busy}>
              {runOne.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Check user
            </Button>
            <Button variant="secondary" onClick={() => runAll.mutate()} disabled={busy}>
              {runAll.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Audit all users
            </Button>
          </div>
        </div>

        {rows && (
          <div className="rounded-2xl border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                {rows.length === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                )}
                <span className="font-bold">
                  {rows.length === 0
                    ? `All ${checked} balances match ✓`
                    : `${rows.length} discrepancy${rows.length === 1 ? "" : "ies"} (of ${checked} checked)`}
                </span>
              </div>
              <Link
                to="/admin/system"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Webhook delivery →
              </Link>
            </div>

            {rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Ledger sum</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-right">Txs</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="text-sm font-medium">{r.display_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.email ?? r.user_id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.balance}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ledgerSum}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-bold ${
                          r.delta > 0 ? "text-amber-400" : "text-destructive"
                        }`}
                      >
                        {r.delta > 0 ? "+" : ""}
                        {r.delta}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.txCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={fix.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Reconcile ${r.email ?? r.user_id}? Sets balance to ledger sum (${r.ledgerSum}). Writes an admin_reconcile transaction.`,
                              )
                            )
                              fix.mutate(r.user_id);
                          }}
                        >
                          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                          Reconcile
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
