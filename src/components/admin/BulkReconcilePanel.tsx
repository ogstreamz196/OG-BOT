import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Upload, Loader2, FileSpreadsheet, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CsvRow {
  user_id: string;
  target: number;
  // resolved after verification:
  current?: number;
  tx_sum?: number;
  email?: string | null;
  status?: "verified" | "mismatch" | "missing_user" | "invalid";
  error?: string;
  selected?: boolean;
}

function parseCsv(text: string): { rows: CsvRow[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], error: "Empty file" };
  const header = lines[0]
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  const idIdx = header.findIndex((h) => h === "user_id" || h === "userid" || h === "id");
  const balIdx = header.findIndex((h) => h === "coin_balance" || h === "balance" || h === "coins");
  if (idIdx === -1 || balIdx === -1) {
    return { rows: [], error: "CSV must include user_id and coin_balance columns" };
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((s) => s.trim());
    const user_id = cols[idIdx];
    const target = Number(cols[balIdx]);
    if (!user_id || !Number.isFinite(target) || target < 0) {
      rows.push({
        user_id: user_id || `(row ${i + 1})`,
        target: NaN,
        status: "invalid",
        error: "Bad row",
      });
      continue;
    }
    rows.push({ user_id, target: Math.trunc(target) });
  }
  return { rows };
}

export function BulkReconcilePanel() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [verifying, setVerifying] = useState(false);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const { rows: parsed, error } = parseCsv(String(reader.result ?? ""));
      if (error) {
        toast.error(error);
        return;
      }
      if (!parsed.length) {
        toast.error("No rows found in CSV");
        return;
      }
      setRows(parsed);
      toast.success(`Loaded ${parsed.length} row(s). Click Verify to reconcile.`);
    };
    reader.readAsText(file);
  }

  const verifyMut = useMutation({
    mutationFn: async () => {
      setVerifying(true);
      const valid = rows.filter((r) => r.status !== "invalid");
      const ids = Array.from(new Set(valid.map((r) => r.user_id)));
      if (!ids.length) return rows;

      // Fetch profiles for current balances + emails
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, coin_balance")
        .in("id", ids);
      if (pErr) throw pErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

      // Fetch all coin_transactions for these users
      const { data: txs, error: tErr } = await supabase
        .from("coin_transactions")
        .select("user_id, amount")
        .in("user_id", ids);
      if (tErr) throw tErr;
      const sumMap = new Map<string, number>();
      for (const t of (txs ?? []) as { user_id: string; amount: number }[]) {
        sumMap.set(t.user_id, (sumMap.get(t.user_id) ?? 0) + t.amount);
      }

      return rows.map((r): CsvRow => {
        if (r.status === "invalid") return r;
        const prof = profMap.get(r.user_id);
        if (!prof) {
          return { ...r, status: "missing_user", error: "User not found" };
        }
        const current = prof.coin_balance as number;
        const tx_sum = sumMap.get(r.user_id) ?? 0;
        const verified = tx_sum === r.target;
        return {
          ...r,
          email: prof.email,
          current,
          tx_sum,
          status: verified ? "verified" : "mismatch",
          selected: verified && current !== r.target,
        };
      });
    },
    onSuccess: (next) => {
      setRows(next);
      setVerifying(false);
    },
    onError: (e: Error) => {
      setVerifying(false);
      toast.error(e.message);
    },
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      const toApply = rows.filter(
        (r) => r.selected && r.status !== "invalid" && r.status !== "missing_user",
      );
      let ok = 0;
      let fail = 0;
      for (const r of toApply) {
        try {
          const { error } = await supabase.rpc("set_balance_admin", {
            target_user_id: r.user_id,
            new_balance: r.target,
            admin_notes: `csv_reconcile: tx_sum=${r.tx_sum} target=${r.target}`,
          });
          if (error) throw error;
          ok++;
        } catch (e) {
          fail++;
          console.error("reconcile failed", r.user_id, (e as Error)?.message);
        }
      }
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      if (ok) toast.success(`Applied ${ok} update(s)`);
      if (fail) toast.error(`${fail} update(s) failed`);
      qc.invalidateQueries({ queryKey: ["admin-profiles-search"] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      // Re-verify to refresh diffs
      verifyMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = useMemo(() => {
    const total = rows.length;
    const verified = rows.filter((r) => r.status === "verified").length;
    const mismatch = rows.filter((r) => r.status === "mismatch").length;
    const missing = rows.filter((r) => r.status === "missing_user").length;
    const invalid = rows.filter((r) => r.status === "invalid").length;
    const selected = rows.filter((r) => r.selected).length;
    return { total, verified, mismatch, missing, invalid, selected };
  }, [rows]);

  function toggleAll(checked: boolean) {
    setRows((rs) =>
      rs.map((r) =>
        r.status === "verified" || r.status === "mismatch" ? { ...r, selected: checked } : r,
      ),
    );
  }
  function toggleOne(idx: number, checked: boolean) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, selected: checked } : r)));
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Bulk balance reconciliation</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          CSV columns: <code>user_id,coin_balance</code>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
          <Upload className="h-4 w-4" />
          <span>Choose CSV</span>
          <Input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={!rows.length || verifying || verifyMut.isPending}
          onClick={() => verifyMut.mutate()}
        >
          {verifyMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Verify against ledger
        </Button>
        <Button
          disabled={!summary.selected || applyMut.isPending}
          onClick={() => applyMut.mutate()}
          className="bg-gradient-brand text-primary-foreground"
        >
          {applyMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Apply {summary.selected || 0} update(s)
        </Button>

        {rows.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <Badge ok>{summary.verified} verified</Badge>
            <Badge warn>{summary.mismatch} mismatch</Badge>
            {summary.missing > 0 && <Badge err>{summary.missing} missing</Badge>}
            {summary.invalid > 0 && <Badge err>{summary.invalid} invalid</Badge>}
            <span className="text-muted-foreground">/ {summary.total} total</span>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      summary.selected > 0 &&
                      summary.selected === summary.verified + summary.mismatch
                    }
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Ledger sum</TableHead>
                <TableHead className="text-right">CSV target</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow
                  key={`${r.user_id}-${i}`}
                  className={cn(r.status === "invalid" && "opacity-60")}
                >
                  <TableCell>
                    <Checkbox
                      checked={!!r.selected}
                      disabled={
                        r.status === "invalid" ||
                        r.status === "missing_user" ||
                        r.current === r.target
                      }
                      onCheckedChange={(v) => toggleOne(i, Boolean(v))}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="truncate max-w-[280px]">{r.email ?? r.user_id}</div>
                    {r.email && (
                      <div className="text-muted-foreground">{r.user_id.slice(0, 8)}…</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.current ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tx_sum ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {Number.isFinite(r.target) ? r.target : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge row={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length > 0 && summary.mismatch > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          Mismatch = CSV target does not equal the sum of <code>coin_transactions</code>. You can
          still tick &amp; apply, but the ledger won't add up afterwards. Prefer adjusting via the
          Award/Deduct panel which logs the delta.
        </p>
      )}
    </div>
  );
}

function Badge({
  children,
  ok,
  warn,
  err,
}: {
  children: React.ReactNode;
  ok?: boolean;
  warn?: boolean;
  err?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        ok && "bg-primary/15 text-primary",
        warn && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        err && "bg-destructive/15 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

function StatusBadge({ row }: { row: CsvRow }) {
  if (row.status === "verified") {
    return row.current === row.target ? (
      <span className="text-xs text-muted-foreground">in sync</span>
    ) : (
      <Badge ok>verified · safe to apply</Badge>
    );
  }
  if (row.status === "mismatch") return <Badge warn>ledger ≠ target</Badge>;
  if (row.status === "missing_user") return <Badge err>user not found</Badge>;
  if (row.status === "invalid") return <Badge err>{row.error || "invalid"}</Badge>;
  return <span className="text-xs text-muted-foreground">pending</span>;
}
