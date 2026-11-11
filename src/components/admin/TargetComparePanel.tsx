import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Target } from "lucide-react";
import { getTargetComparison } from "@/lib/signal-tuning.functions";
import { cn } from "@/lib/utils";
import { AdminSection } from "./AdminSection";

const money = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const ratioName = (r: number | null, current: number | null) =>
  r == null
    ? `Now (about ${current != null ? current.toFixed(2) : "?"} : 1)`
    : r === 1
      ? "1 : 1 (same as the stop)"
      : `${r} : 1`;

/**
 * Boss: the take profit question. The same past setups replayed with the take
 * profit signals use now and at other sizes against the stop, with the spread
 * and the profit lock. Read only: nothing live changes from here.
 */
export function TargetComparePanel() {
  const load = useServerFn(getTargetComparison);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-tp-compare"],
    queryFn: () => load(),
    staleTime: 5 * 60_000,
  });

  return (
    <AdminSection
      icon={<Target className="h-4 w-4 text-emerald-400" />}
      title="Take profit size"
      subtitle="Every stored setup from the last 90 days, replayed with today's learned setting, Vantage's spread and the 70/30 profit lock, once with the take profit signals use now and again with bigger or smaller ones. Read only: this changes nothing live. A bigger target wins less often, so only the money tells you which is better."
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Replaying the stored setups…
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">Couldn't run the comparison right now.</p>
      ) : !data.length ? (
        <p className="text-sm text-muted-foreground">
          No stored setups yet. The learning loop keeps them as it studies.
        </p>
      ) : (
        <div className="space-y-6">
          {data.map((m) => (
            <div key={m.market} className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {m.market === "BTCUSD" ? "Bitcoin" : m.market} · {m.days} days · dollars at {m.lot}{" "}
                lot
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-semibold">Take profit : stop</th>
                      <th className="py-2 pr-3 text-right font-semibold">Trades</th>
                      <th className="py-2 pr-3 text-right font-semibold">Win rate</th>
                      <th className="py-2 text-right font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr
                        key={String(r.ratio)}
                        className={cn(
                          "border-t border-border/60",
                          m.best !== undefined && r.ratio === m.best && "bg-emerald-500/10",
                        )}
                      >
                        <td className="py-2 pr-3 font-semibold text-foreground">
                          {ratioName(r.ratio, m.currentRatio)}
                          {m.best !== undefined && r.ratio === m.best ? (
                            <span className="ml-2 text-xs text-emerald-400">best</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.n}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {Math.round(r.winRate * 100)}%
                        </td>
                        <td
                          className={cn(
                            "py-2 text-right font-semibold tabular-nums",
                            r.cash >= 0 ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {money(r.cash)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
