import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CloudUpload, Download, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listCardTransactions, saveAccountantCsvToDrive, type CardTxRow } from "@/lib/accounting.functions";

type Period = { key: string; label: string; from: string; to: string };

function periods(): Period[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const out: Period[] = [];
  const curTaxStart = now >= new Date(Date.UTC(y, 3, 6)) ? y : y - 1;
  for (let s = curTaxStart; s >= curTaxStart - 2; s--) {
    out.push({
      key: `tax-${s}`,
      label: `UK tax year ${s}/${String(s + 1).slice(2)}`,
      from: `${s}-04-06`,
      to: `${s + 1}-04-05`,
    });
  }
  for (let c = y; c >= y - 2; c--)
    out.push({ key: `cal-${c}`, label: `Calendar ${c}`, from: `${c}-01-01`, to: `${c}-12-31` });
  return out;
}

const gbp = (n: number) => `£${n.toFixed(2)}`;
const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function AccountantLogPanel() {
  const list = useServerFn(listCardTransactions);
  const saveDrive = useServerFn(saveAccountantCsvToDrive);
  const [saving, setSaving] = useState(false);
  const opts = useMemo(periods, []);
  const [key, setKey] = useState(opts[0].key);
  const [cat, setCat] = useState("All");
  const p = opts.find((o) => o.key === key)!;

  const q = useQuery({
    queryKey: ["accountant-log", p.from, p.to],
    queryFn: () => list({ data: { from: `${p.from}T00:00:00Z`, to: `${p.to}T23:59:59Z` } }),
    staleTime: 60_000,
  });
  const err = q.data && "error" in q.data ? q.data.error : null;
  const all: CardTxRow[] = q.data && "rows" in q.data ? q.data.rows : [];
  const rows = cat === "All" ? all : all.filter((r) => r.category === cat);
  const cats = ["All", ...Array.from(new Set(all.map((r) => r.category)))];
  const sum = (f: (r: CardTxRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const gross = sum((r) => r.gross);
  const fees = sum((r) => r.fee);
  const refunds = sum((r) => r.refunded);
  const net = gross - fees - refunds;

  const buildCsv = () => {
    const header = [
      "Date", "Time (UTC)", "Transaction ID", "Payment Intent", "Category", "Description",
      "Customer Name", "Customer Email", "Currency", "Gross Amount", "Stripe Fee",
      "Net Amount", "Refund Amount", "Status", "Payment Method", "Card Last 4", "Receipt URL",
    ];
    const body = rows.map((r) => [
      r.created.slice(0, 10), r.created.slice(11, 19), r.id, r.paymentIntent ?? "", r.category,
      r.description, r.customerName ?? "", r.customerEmail ?? "", r.currency,
      r.gross.toFixed(2), r.fee.toFixed(2), r.net.toFixed(2), r.refunded.toFixed(2),
      r.status, r.method, r.last4 ?? "", r.receiptUrl ?? "",
    ]);
    const totals = ["TOTAL", "", "", "", "", `${rows.length} transactions`, "", "", "GBP",
      gross.toFixed(2), fees.toFixed(2), (gross - fees).toFixed(2), refunds.toFixed(2), "", "", "", ""];
    return [header, ...body, [], totals].map((r) => r.map(esc).join(",")).join("\n");
  };
  const fileName = `og-bot-card-transactions-${p.from}-to-${p.to}.csv`;
  const toDrive = async () => {
    setSaving(true);
    try {
      const folder = p.key.startsWith("tax-")
        ? `Tax Year ${p.from.slice(0, 4)}-${p.to.slice(2, 4)}`
        : `Calendar ${p.from.slice(0, 4)}`;
      const res = await saveDrive({ data: { folder, fileName, csv: buildCsv() } });
      if ("error" in res) throw new Error(res.error);
      toast.success(`Saved to Drive → PURCHASE REVIEW / ${folder}`);
      if (res.link) window.open(res.link, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drive save failed");
    } finally {
      setSaving(false);
    }
  };
  const exportCsv = () => {
    const csv = buildCsv();
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Period</span>
          <select value={key} onChange={(e) => setKey(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Category</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" className="ml-auto" onClick={toDrive} disabled={!rows.length || saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-1.5 h-4 w-4" />} Save to Drive
        </Button>
        <Button size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-1.5 h-4 w-4" /> Export for accountant
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{p.from} → {p.to} · live card payments only</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[["Gross", gross], ["Refunds", refunds], ["Stripe fees", fees], ["Net", net]].map(([l, v]) => (
          <div key={l as string} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">{l}</p>
            <p className="font-mono text-lg font-bold tabular-nums">{gbp(v as number)}</p>
          </div>
        ))}
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Transactions</p>
          <p className="font-mono text-lg font-bold">{rows.length}</p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : err ? (
        <p className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{err}</p>
      ) : !rows.length ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No card payments in this period.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{r.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created).toLocaleString("en-GB")} · {r.category}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono font-bold">{gbp(r.gross)}</p>
                  <p className="text-[11px] text-muted-foreground">{r.status}</p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="truncate">{r.customerName ?? "—"} {r.customerEmail ? `· ${r.customerEmail}` : ""}</dd>
                <dt className="text-muted-foreground">Fee / Net</dt>
                <dd className="font-mono">{gbp(r.fee)} / {gbp(r.net)}</dd>
                <dt className="text-muted-foreground">Method</dt>
                <dd className="capitalize">{r.method}{r.last4 ? ` ••${r.last4}` : ""}</dd>
                <dt className="text-muted-foreground">Ref</dt>
                <dd className="truncate font-mono">{r.id}</dd>
                {r.refunded > 0 && (<><dt className="text-muted-foreground">Refunded</dt><dd className="font-mono">{gbp(r.refunded)}</dd></>)}
              </dl>
              {r.receiptUrl && (
                <a href={r.receiptUrl} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline">
                  <Receipt className="h-3 w-3" /> Receipt
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
