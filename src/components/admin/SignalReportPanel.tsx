import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { getSignalReport, type ReportDays } from "@/lib/signal-report.functions";
import type { MarketReport, Stat, TimingStats } from "@/lib/signal-report.server";
import { cn } from "@/lib/utils";
import { AdminSection } from "./AdminSection";

const PERIODS: ReportDays[] = [7, 30, 90];
const SESSION_NAMES: Record<string, string> = {
  asia: "Asian session",
  london: "London session",
  newyork: "New York session",
  evening: "Evening",
  weekend: "Weekend",
};

/**
 * Boss: where the signals' wins and losses really come from, and how the
 * setups the bot didn't send (shadow trades) would have done.
 */
export function SignalReportPanel() {
  const load = useServerFn(getSignalReport);
  const [days, setDays] = useState<ReportDays>(30);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-report", days],
    queryFn: () => load({ data: { days } }),
    staleTime: 60_000,
  });

  return (
    <AdminSection
      icon={<BarChart3 className="h-4 w-4 text-emerald-400" />}
      title="Signal report"
      subtitle="Where the wins and losses come from: by confidence, session, what the AI desk said and which setup made it. Below each market, the setups the bot didn't send, followed silently, so you can see if each filter is earning its place. Pips are shown before and after a typical spread."
      action={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              aria-pressed={days === p}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-bold",
                days === p
                  ? "border-emerald-400 bg-emerald-500 text-black"
                  : "border-border text-muted-foreground",
              )}
            >
              {p}d
            </button>
          ))}
        </div>
      }
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">Couldn't read the report right now.</p>
      ) : !data.report.markets.length ? (
        <p className="text-sm text-muted-foreground">
          No finished signals in the last {days} days yet.
        </p>
      ) : (
        <div className="space-y-6">
          {data.report.markets.map((m) => (
            <MarketBlock key={m.market} m={m} sessions={data.sessions[m.market] ?? []} />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function MarketBlock({
  m,
  sessions,
}: {
  m: MarketReport;
  sessions: { id: string; minConfidence: number; stopRoom: number; n: number; winRate: number }[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-black text-foreground">{m.label}</h3>
        <p className="text-xs text-muted-foreground">
          Spread counted: {m.spread} {m.unit} a trade
        </p>
      </div>
      <Table title="Overall" rows={[m.overall]} unit={m.unit} />
      <Timing t={m.timing} unit={m.unit} />
      <Table title="By confidence" rows={m.byBand} unit={m.unit} />
      <Table title="By session (UK time)" rows={m.bySession} unit={m.unit} />
      <Table title="By what the AI desk said" rows={m.byDesk} unit={m.unit} />
      <Table title="By setup" rows={m.bySetup} unit={m.unit} />
      <Table title="By chart" rows={m.byTimeframe} unit={m.unit} />
      {m.byCheck.length > 0 && (
        <Table title="Pair checks (live trial)" rows={m.byCheck} unit={m.unit} />
      )}
      {m.shadows === null ? (
        <p className="text-xs text-muted-foreground">
          Shadow trades start once their table is set up.
        </p>
      ) : (
        <Table
          title="Not sent (shadow trades)"
          rows={m.shadows}
          unit={m.unit}
          shadow
          empty="No shadow trades have finished yet."
        />
      )}
      {sessions.length > 0 && (
        <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-bold text-foreground">Learned per session right now</p>
          {sessions.map((s) => (
            <p key={s.id}>
              {SESSION_NAMES[s.id] ?? s.id}: trades from {s.minConfidence}%, stop room ×
              {s.stopRoom.toFixed(2)} · replay won {Math.round(s.winRate * 100)}% of {s.n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

function Table({
  title,
  rows,
  unit,
  shadow,
  empty,
}: {
  title: string;
  rows: Stat[];
  unit: string;
  shadow?: boolean;
  empty?: string;
}) {
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {!rows.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{empty ?? "Nothing yet."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-emerald-400">{r.wins} won</span> ·{" "}
                  <span className="text-rose-400">{r.losses} lost</span>
                  {shadow && (r.flat || r.unfilled)
                    ? ` · ${r.flat ?? 0} flat · ${r.unfilled ?? 0} never filled`
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-sm font-black tabular-nums",
                    r.winRate == null
                      ? "text-muted-foreground"
                      : r.winRate >= 0.5
                        ? "text-emerald-400"
                        : "text-rose-400",
                  )}
                >
                  {pct(r.winRate)}
                </p>
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    r.netPips >= 0 ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {signed(r.netPips)} {unit} net
                  <span className="text-muted-foreground"> ({signed(r.pips)} gross)</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const num = (n: number | null, suffix: string) => (n == null ? "–" : `${n}${suffix}`);

/** How late the alerts went out, and how long trades take. */
function Timing({ t, unit }: { t: TimingStats; unit: string }) {
  const rows: [string, string, string?][] = [
    ["Candle close to alert", num(t.delaySec, "s"), "median"],
    ["AI check before posting", num(t.checkSec, "s"), "median"],
    [
      "Price moved by the time it posted",
      t.driftPips == null ? "–" : `${t.driftPips >= 0 ? "+" : "−"}${Math.abs(t.driftPips)} ${unit}`,
      "+ is towards the take profit",
    ],
    [
      "Pending entries filled",
      t.fillRate == null ? "–" : `${Math.round(t.fillRate * 100)}%`,
      t.fillMin == null ? undefined : `median ${t.fillMin} min to fill`,
    ],
    ["Time to take profit", num(t.winMin, " min"), "median, after the fill"],
    ["Time to stop loss", num(t.lossMin, " min"), "median, after the fill"],
    ["Closed on a time stop", String(t.timeStops)],
  ];
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Timing{t.alerts ? ` · ${t.alerts} timed alerts` : ""}
      </p>
      <ul className="divide-y divide-border">
        {rows.map(([label, value, note]) => (
          <li key={label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{label}</p>
              {note && <p className="text-xs text-muted-foreground">{note}</p>}
            </div>
            <p className="text-sm font-black tabular-nums text-foreground">{value}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
