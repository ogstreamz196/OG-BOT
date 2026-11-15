import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { AUTOPSY_KINDS, AUTOPSY_LABEL } from "@/lib/signal-autopsy";
import { getAutopsy } from "@/lib/signal-autopsy.functions";
import { AdminSection } from "./AdminSection";

const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };
const STRATEGY_LABEL: Record<string, string> = { engine: "Chart engine", desk: "AI desk" };
const nice = (s: string) => STRATEGY_LABEL[s] ?? s.replace(/_/g, " ");

/** Why the losing signals lost, per market and strategy, and what to change. Read-only. */
export function LossAutopsyPanel() {
  const get = useServerFn(getAutopsy);
  const q = useQuery({
    queryKey: ["boss", "autopsy"],
    queryFn: () => get(),
    refetchInterval: 120_000,
  });
  const d = q.data;
  return (
    <AdminSection
      icon={<Stethoscope className="h-5 w-5 text-amber-300" />}
      title="Why trades lost"
      subtitle="Every stopped-out signal is checked against what price did next: was the stop where the entry should have been, too tight, was the win given back, or was the direction wrong?"
    >
      {q.isError ? (
        <p className="text-sm text-rose-400">Couldn't load this. Refresh to try again.</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : d.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing studied yet. It works back through the last 90 days of losses a few at a time
          whenever the bot isn't busy, so give it a few hours.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{d.studied} losses studied so far.</p>
          {d.rows.map((r) => (
            <div
              key={`${r.market}:${r.strategy}`}
              className="rounded-lg border border-border bg-card/60 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">
                  {MARKET_LABEL[r.market] ?? r.market} · {nice(r.strategy)}
                </div>
                <div className="text-xs text-muted-foreground">{r.losses} losses</div>
              </div>
              <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {AUTOPSY_KINDS.map((k) => (
                  <li
                    key={k}
                    className={k === r.main ? "font-bold text-foreground" : "text-muted-foreground"}
                  >
                    {AUTOPSY_LABEL[k]}: {r.counts[k]} ({Math.round((100 * r.counts[k]) / r.losses)}
                    %)
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                <span className="font-bold text-amber-300">Lesson ({r.mainShare}%):</span>{" "}
                {r.lesson}
              </p>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
