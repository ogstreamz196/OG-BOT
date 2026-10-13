import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Coins, Crown, Download, Loader2, Receipt } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAllCoinPurchases } from "@/lib/payments.functions";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";

type RangeKey = "all" | "today" | "week" | "month" | "custom";
const PAGE_SIZES = [25, 50, 100, 250] as const;

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek() {
  const d = startOfToday();
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth() {
  const d = startOfToday();
  d.setDate(1);
  return d;
}
function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function AllPurchasesPanel() {
  const { isBoss, isAdmin } = useRole();
  const fetchAll = useServerFn(getAllCoinPurchases);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState<string>(toInputDate(startOfMonth()));
  const [customTo, setCustomTo] = useState<string>(toInputDate(new Date()));
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["admin-all-coin-purchases"],
    queryFn: () => fetchAll(),
    enabled: (isBoss || isAdmin) && open,
    staleTime: 30_000,
  });

  const { fromTs, toTs } = useMemo(() => {
    const now = new Date();
    if (range === "today") return { fromTs: startOfToday().getTime(), toTs: now.getTime() };
    if (range === "week") return { fromTs: startOfWeek().getTime(), toTs: now.getTime() };
    if (range === "month") return { fromTs: startOfMonth().getTime(), toTs: now.getTime() };
    if (range === "custom") {
      const f = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
      const t = customTo ? new Date(customTo + "T23:59:59").getTime() : Date.now();
      return { fromTs: f, toTs: t };
    }
    return { fromTs: 0, toTs: Date.now() };
  }, [range, customFrom, customTo]);

  const allItems = q.data?.items ?? [];
  const items = useMemo(() => {
    if (range === "all") return allItems;
    return allItems.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [allItems, range, fromTs, toTs]);

  const totalCoins = items.reduce((s, r) => s + r.amount, 0);
  const totalUsers = new Set(items.map((r) => r.user_id)).size;

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = items.slice(pageStart, pageStart + pageSize);

  // Reset to page 1 when filter inputs change
  useEffect(() => {
    setPage(1);
  }, [range, fromTs, toTs, pageSize]);

  const downloadCsv = () => {
    const header = ["created_at", "user_id", "display_name", "email", "amount_coins", "reference"];
    const rows = items.map((r) => [
      r.created_at,
      r.user_id,
      r.display_name ?? "",
      r.email ?? "",
      r.amount,
      (r as { reference?: string | null }).reference ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!isBoss && !isAdmin) return null;

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <div className="text-sm font-bold uppercase tracking-wide text-amber-300">
              Boss view · All purchases
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {q.data
                ? `${items.length} purchases · ${totalUsers} buyers · ${totalCoins.toLocaleString()} coins`
                : "Tap to load every user's purchase history"}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Range filter row */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All time"],
                ["today", "Today"],
                ["week", "This week"],
                ["month", "This month"],
                ["custom", "Custom"],
              ] as Array<[RangeKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                aria-pressed={range === key}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                  range === key
                    ? "border-amber-400 bg-amber-400/20 text-amber-200"
                    : "border-border/50 bg-background/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={downloadCsv}
                disabled={items.length === 0}
                className="h-8 gap-1.5 text-xs"
                aria-label="Download purchase history as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          </div>

          {range === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-muted-foreground">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-md border border-border/50 bg-background/40 px-2 py-1 text-foreground"
                />
              </label>
              <label className="flex items-center gap-1 text-muted-foreground">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-md border border-border/50 bg-background/40 px-2 py-1 text-foreground"
                />
              </label>
            </div>
          )}

          {q.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading purchases…
            </div>
          )}
          {q.error && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
          {!q.isLoading && !q.error && items.length === 0 && (
            <p className="text-xs text-muted-foreground">No purchases in this range.</p>
          )}
          {items.length > 0 && (
            <>
              <ul className="max-h-96 overflow-y-auto divide-y divide-border/40 rounded-lg border border-border/40 bg-background/40">
                {pageItems.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <Receipt className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">
                        {r.display_name ?? r.email ?? r.user_id.slice(0, 8)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {fmtDate(r.created_at)}
                        {r.email && r.display_name ? ` · ${r.email}` : ""}
                      </div>
                    </div>
                    <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-coin/30 bg-coin/10 px-2 py-0.5 font-mono tabular-nums text-coin">
                      <Coins className="h-3 w-3" />+{r.amount.toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  Page size
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="rounded-md border border-border/50 bg-background/40 px-1.5 py-1 text-foreground"
                    aria-label="Rows per page"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="tabular-nums">
                  {pageStart + 1}-{Math.min(pageStart + pageSize, items.length)} of {items.length}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="h-7 px-2 text-xs"
                    aria-label="Previous page"
                  >
                    Prev
                  </Button>
                  <span className="px-1 tabular-nums">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="h-7 px-2 text-xs"
                    aria-label="Next page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
