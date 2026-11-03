import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Dices, Loader2 } from "lucide-react";
import { getStrategyBoard, type BoardDays } from "@/lib/signal-tuning.functions";
import { cn } from "@/lib/utils";
import { AdminSection } from "./AdminSection";

const PERIODS: BoardDays[] = [7, 30, 60];

const money = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Boss: how each strategy is doing (the chart engine, the AI desk and every
 * chart setup), best first. The bot leans towards the ones on top when it
 * picks a random signal's strategy, so this is the mix it's learning.
 */
export function StrategyBoardPanel() {
  const load = useServerFn(getStrategyBoard);
  const [days, setDays] = useState<BoardDays>(30);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["strategy-board", days],
    queryFn: () => load({ data: { days } }),
    staleTime: 60_000,
  });

  return (
    <AdminSection
      icon={<Dices className="h-4 w-4 text-emerald-400" />}
      title="Strategy scoreboard"
      subtitle="Every finished signal, sorted by the strategy that made it. Demo $ is what the demo account made on the trades it took, after the spread. Profit per trade is in risks, so a strategy that wins often but small can't hide a loss."
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
        <p className="text-sm text-muted-foreground">Couldn't read the scoreboard right now.</p>
      ) : !data.rows.length ? (
        <p className="text-sm text-muted-foreground">
          No finished signals in the last {days} days yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Strategy</th>
                <th className="py-2 pr-3 text-right font-semibold">Trades</th>
                <th className="py-2 pr-3 text-right font-semibold">Won</th>
                <th className="py-2 pr-3 text-right font-semibold">Lost</th>
                <th className="py-2 pr-3 text-right font-semibold">Per trade</th>
                <th className="py-2 text-right font-semibold">Demo $</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const decided = r.wins + r.losses;
                const per = r.n ? r.sumR / r.n : 0;
                return (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 pr-3 font-semibold text-foreground">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.n}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.wins}
                      {decided ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({Math.round((r.wins / decided) * 100)}%)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.losses}</td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right font-semibold tabular-nums",
                        per >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {per >= 0 ? "+" : "−"}
                      {Math.abs(per).toFixed(2)}R
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  );
}
