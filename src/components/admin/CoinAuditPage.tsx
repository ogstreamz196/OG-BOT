import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldCheck,
} from "lucide-react";
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
  resetMemberBalances,
  type CoinDiscrepancy,
} from "@/lib/coin-audit.functions";
import { ConfirmAction } from "@/components/admin/ConfirmAction";

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
      toast.success(`Checked ${res.checked} members, ${res.discrepancies.length} out of step`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runOne = useMutation({
    mutationFn: async () => audit({ data: { userId: userId.trim() } }),
    onSuccess: (res) => {
      if ("error" in res) return toast.error(res.error);
      setRows(res.discrepancies);
      setChecked(res.checked);
      if (res.checked === 0) toast.error("No member with that id");
      else if (res.discrepancies.length === 0) toast.success("Balance matches the ledger");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fix = useMutation({
    mutationFn: async (v: { uid: string; trust: "ledger" | "balance" }) =>
      reconcile({ data: { userId: v.uid, trust: v.trust } }),
    onSuccess: (res) => {
      if ("error" in res) return toast.error(res.error);
      toast.success(
        res.delta === 0
          ? "Balance kept; ledger corrected"
          : `Balance ${res.previous} → ${res.corrected}`,
      );
      if (rows) setRows(rows.filter((r) => r.user_id !== res.user_id));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = runAll.isPending || runOne.isPending;
  const isUuid = /^[0-9a-f-]{36}$/i.test(userId.trim());

  return (
    <DashboardShell title="Coin Balance Audit">
      <div className="w-full min-w-0 space-y-6">
        <div className="og-panel rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Balances against the ledger</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Every coin move is written to the ledger, so each member's balance should equal the sum
            of their ledger. This checks every member and lists anyone out of step.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Label htmlFor="uid" className="text-xs">
                Check one member (account id)
              </Label>
              <Input
                id="uid"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={() => runOne.mutate()} disabled={!isUuid || busy}>
              {runOne.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Check member
            </Button>
            <Button variant="secondary" onClick={() => runAll.mutate()} disabled={busy}>
              {runAll.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Check everyone
            </Button>
          </div>
        </div>

        {rows && (
          <div className="og-panel rounded-2xl border border-border bg-card shadow-card">
            <div className="flex items-center gap-2 border-b border-border px-6 py-4">
              {rows.length === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              )}
              <span className="font-bold">
                {rows.length === 0
                  ? `All ${checked} balances match the ledger`
                  : `${rows.length} out of step (of ${checked} checked)`}
              </span>
            </div>

            {rows.length > 0 && (
              <>
                <p className="px-6 pt-4 text-xs text-muted-foreground">
                  <b>Use ledger</b> sets the balance to what the history adds up to (use this if you
                  suspect someone gained coins they shouldn't have). <b>Keep balance</b> leaves
                  their coins alone and adds a labelled correction to the history. Both are logged.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">Ledger</TableHead>
                        <TableHead className="text-right">Gap</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
                        <TableHead className="text-right">Fix</TableHead>
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
                            className={`text-right font-bold tabular-nums ${
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
                            <div className="flex justify-end gap-1.5">
                              <ConfirmAction
                                title="Use the ledger?"
                                description={
                                  <p>
                                    {r.display_name ?? r.email ?? "This member"}'s balance goes from{" "}
                                    {r.balance} to {Math.max(0, r.ledgerSum)}.
                                  </p>
                                }
                                confirmLabel="Use ledger"
                                tooltip="Set the balance to the ledger total"
                                onConfirm={() => fix.mutate({ uid: r.user_id, trust: "ledger" })}
                              >
                                <Button size="sm" variant="outline" disabled={fix.isPending}>
                                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                  Use ledger
                                </Button>
                              </ConfirmAction>
                              <ConfirmAction
                                title="Keep this balance?"
                                description={
                                  <p>
                                    {r.display_name ?? r.email ?? "This member"} keeps {r.balance}{" "}
                                    coins and a correction of {r.delta > 0 ? "+" : ""}
                                    {r.delta} is added to their ledger.
                                  </p>
                                }
                                confirmLabel="Keep balance"
                                tooltip="Keep the balance and correct the ledger"
                                onConfirm={() => fix.mutate({ uid: r.user_id, trust: "balance" })}
                              >
                                <Button size="sm" variant="ghost" disabled={fix.isPending}>
                                  Keep balance
                                </Button>
                              </ConfirmAction>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        <BalanceResetPanel />
      </div>
    </DashboardShell>
  );
}

const RESET_TARGET = 20;

/** One-off: every member except Boss accounts to 20 coins, in batches, ledger kept clean. */
function BalanceResetPanel() {
  const resetFn = useServerFn(resetMemberBalances);
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    processed: number;
    changed: number;
    skippedBoss: number;
    corrected: number;
    done: boolean;
  } | null>(null);

  async function run() {
    setRunning(true);
    const runId = `reset-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
    const totals = { processed: 0, changed: 0, skippedBoss: 0, corrected: 0, done: false };
    setProgress({ ...totals });
    let afterId: string | null = null;
    try {
      for (;;) {
        const res = await resetFn({
          data: { runId, target: RESET_TARGET, afterId, confirm: "RESET" },
        });
        if ("error" in res) {
          toast.error(res.error);
          break;
        }
        totals.processed += res.processed;
        totals.changed += res.changed;
        totals.skippedBoss += res.skippedBoss;
        totals.corrected += res.corrected;
        setProgress({ ...totals });
        if (!res.nextAfterId) {
          totals.done = true;
          setProgress({ ...totals });
          toast.success(`Reset done: ${totals.changed} balances set to ${RESET_TARGET}`);
          break;
        }
        afterId = res.nextAfterId;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset stopped");
    } finally {
      setRunning(false);
      setTyped("");
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-destructive/50 bg-card p-6 shadow-card">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-5 w-5 text-destructive" />
        <h2 className="text-lg font-bold">Reset every member to {RESET_TARGET} coins</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Sets every member's balance to {RESET_TARGET}. Boss accounts are left alone. Any old gap
        between a balance and its ledger is written into the ledger first, then the new balance is
        recorded, so afterwards every member's ledger adds up exactly. This can't be undone. If it
        stops part way, running it again carries on safely.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="reset-confirm" className="text-xs">
            Type RESET to confirm
          </Label>
          <Input
            id="reset-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
            disabled={running}
          />
        </div>
        <Button variant="destructive" disabled={typed !== "RESET" || running} onClick={run}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Reset balances
        </Button>
      </div>
      {progress ? (
        <p className="text-xs text-muted-foreground">
          {progress.done ? "Finished. " : "Working… "}
          {progress.processed} members checked, {progress.changed} set to {RESET_TARGET},{" "}
          {progress.skippedBoss} Boss accounts skipped, {progress.corrected} old ledger gaps
          recorded.
        </p>
      ) : null}
    </div>
  );
}
