import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, Loader2 } from "lucide-react";
import { getDataRoom, type DataRoomEntry } from "@/lib/signal-dataroom.functions";
import { AdminSection } from "./AdminSection";

const PERIODS = [7, 30, 90] as const;

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const r2 = (n: number) => (Math.round(n * 100) / 100).toString();

const WON = new Set(["tp1", "tp2", "tp3", "breakeven", "expired"]);
const outcome = (e: DataRoomEntry) => {
  if (["open", "pending"].includes(e.status)) return { label: "running", cls: "text-amber-300" };
  if (e.status === "unfilled") return { label: "cancelled", cls: "text-muted-foreground" };
  if (e.status === "stopped") return { label: "lost", cls: "text-rose-400" };
  if (WON.has(e.status) && (e.best_target ?? 0) > 0)
    return { label: "won", cls: "text-emerald-400" };
  return { label: e.status, cls: "text-muted-foreground" };
};

export function SignalDataRoom() {
  const load = useServerFn(getDataRoom);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-dataroom", days],
    queryFn: () => load({ data: { days } }),
    staleTime: 30_000,
  });

  return (
    <AdminSection
      icon={<Database className="h-4 w-4 text-emerald-400" />}
      title="Data room"
      subtitle="Every signal entry and the learning data behind the bot, read only. Nothing here is ever deleted — the view just shows a recent window."
      muted
      action={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                days === p
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      }
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading the data room…
        </p>
      ) : isError || !data ? (
        <p className="py-8 text-center text-sm text-rose-300">Couldn't load the data room.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={`Entries · last ${data.days}d`}
              value={data.counts.entries.toLocaleString()}
            />
            <Stat label="Learning samples" value={data.counts.learnSamples.toLocaleString()} />
            <Stat label="Shadow trades" value={data.counts.shadows.toLocaleString()} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.learning.map((m) => (
              <div key={m.market} className="rounded-xl border border-border bg-background/40 p-4">
                <p className="font-display text-sm font-bold text-foreground">{m.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.current ? (
                    <>
                      last period{" "}
                      <span className="font-semibold text-emerald-400">
                        {pct(m.current.winRate)}
                      </span>{" "}
                      win · {m.current.n} trades · avg {r2(m.current.avgR)}R
                    </>
                  ) : (
                    "no studied period yet"
                  )}
                  {" · "}
                  {m.runs} learning runs · last run {when(m.lastRunAt)}
                </p>
                {m.lesson ? <p className="mt-2 text-xs text-amber-200">{m.lesson}</p> : null}
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="py-2 pr-3 font-semibold">Market</th>
                  <th className="py-2 pr-3 font-semibold">Side</th>
                  <th className="py-2 pr-3 font-semibold">TF</th>
                  <th className="py-2 pr-3 font-semibold">Conf</th>
                  <th className="py-2 pr-3 font-semibold">Entry</th>
                  <th className="py-2 pr-3 font-semibold">Stop</th>
                  <th className="py-2 pr-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {data.entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No entries in this window.
                    </td>
                  </tr>
                ) : (
                  data.entries.map((e) => {
                    const o = outcome(e);
                    return (
                      <tr key={e.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                          {time(e.created_at)}
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{e.label ?? e.market}</td>
                        <td
                          className={`py-1.5 pr-3 font-semibold ${
                            e.direction === "BUY" ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {e.direction}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {(e.timeframe ?? "").toUpperCase() || "—"}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{e.confidence_pct ?? "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{e.entry ?? "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{e.stop ?? "—"}</td>
                        <td className={`py-1.5 pr-3 font-semibold ${o.cls}`}>{o.label}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.7rem] text-muted-foreground">
            Showing the latest {data.entries.length} entries in the window. The full history stays
            in the database for the bot to keep learning from.
          </p>
        </>
      )}
    </AdminSection>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-black text-foreground tabular-nums">{value}</p>
    </div>
  );
}
