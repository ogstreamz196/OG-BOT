import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { getMicroLab } from "@/lib/micro-scalp.functions";
import { PROVEN_MIN_TRADES } from "@/lib/micro-scalp";
import { RAPID_PROVEN_MIN, type RapidRow } from "@/lib/rapid-scalp";
import { AdminSection } from "./AdminSection";

const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };
const holdLabel = (s: number) => (s < 60 ? `${s} sec` : `${s / 60} min`);
const sp = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;

/**
 * The HFT lab: every micro strategy at every hold time, scored on live
 * 1-second prices at Vantage's cost. Read-only; nothing here trades.
 */
export function HftLabPanel() {
  const get = useServerFn(getMicroLab);
  const q = useQuery({
    queryKey: ["boss", "microlab"],
    queryFn: () => get(),
    refetchInterval: 60_000,
  });
  const [market, setMarket] = useState("XAUUSD");
  const rows = q.data?.markets.find((m) => m.market === market)?.rows ?? [];
  const rapid = q.data?.markets.find((m) => m.market === market)?.rapid ?? [];
  const leader = rows.find((r) => r.proven);
  const best15 = rows.filter((r) => r.hold === 15).sort((a, b) => b.perTrade - a.perTrade)[0];

  return (
    <AdminSection
      icon={<FlaskConical className="h-5 w-5 text-emerald-400" />}
      title="HFT lab"
      subtitle="Nine quick-trade strategies at 15 seconds, 1, 2 and 5 minutes, scored every minute on live prices after Vantage's spread, each opening 2 seconds after its signal like a real copied trade. It only watches: nothing here posts or copies a trade."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.keys(MARKET_LABEL).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            aria-pressed={m === market}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              m === market
                ? "border-emerald-400/70 bg-emerald-500/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {MARKET_LABEL[m]}
          </button>
        ))}
      </div>

      {q.data && <RapidFire rows={rapid} gold={market === "XAUUSD"} />}

      {q.isError ? (
        <p className="text-sm text-rose-400">Couldn't load the lab. Refresh to try again.</p>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No trades scored yet. The lab starts within a minute of going live
          {market === "XAUUSD" ? " (gold only while Vantage has it open)" : ""}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card/60 p-3 text-sm">
            {leader ? (
              <p>
                <span className="font-bold text-emerald-400">Proven:</span> {leader.label},{" "}
                {holdLabel(leader.hold)} hold, {sp(leader.perTrade)} spreads a trade after costs
                over {leader.n} trades.
              </p>
            ) : (
              <p>
                <span className="font-bold text-amber-300">Nothing proven yet.</span> A strategy
                needs {PROVEN_MIN_TRADES} trades, money made after the spread, a better result than
                the coin flip, and its last 50 trades not losing.
              </p>
            )}
            {best15 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Best at 15 seconds: {best15.label}, {sp(best15.perTrade)} spreads a trade (
                {best15.winRate}% wins).
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2">Strategy</th>
                  <th className="pr-2">Hold</th>
                  <th className="pr-2 text-right">Trades</th>
                  <th className="pr-2 text-right">Wins</th>
                  <th
                    className="pr-2 text-right"
                    title="Average per trade after the spread, in spreads"
                  >
                    Per trade
                  </th>
                  <th className="pr-2 text-right" title="Average of the last 50 trades">
                    Lately
                  </th>
                  <th className="pr-2 text-right">Now</th>
                  <th className="pr-2 text-right">Best run</th>
                  <th className="text-right">Worst run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr
                    key={`${r.strategy}@${r.hold}`}
                    className={r.proven ? "bg-emerald-500/10" : ""}
                  >
                    <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
                    <td className="pr-2">{holdLabel(r.hold)}</td>
                    <td className="pr-2 text-right">{r.n}</td>
                    <td className="pr-2 text-right">{r.winRate}%</td>
                    <td
                      className={`pr-2 text-right font-bold ${r.perTrade > 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {sp(r.perTrade)}
                    </td>
                    <td
                      className={`pr-2 text-right ${r.lately > 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {sp(r.lately)}
                    </td>
                    <td className="pr-2 text-right">
                      {r.streak > 0 ? `${r.streak} won` : r.streak < 0 ? `${-r.streak} lost` : "–"}
                    </td>
                    <td className="pr-2 text-right">{r.bestWinStreak} won</td>
                    <td className="text-right">{r.worstLossStreak} lost</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Per trade is measured in spreads after paying the spread (+1.00 = made one spread). Gold
            is priced from the gold token the tracker already uses; trades are scored one at a time
            per strategy, so a run of wins means separate trades, not one move counted many times.
          </p>
        </div>
      )}
    </AdminSection>
  );
}

const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;

/**
 * Rapid fire: the Boss's plan (2 trades every 3-5 seconds, no open limit,
 * closing on small profits), scored live before it goes near real money.
 */
function RapidFire({ rows, gold }: { rows: RapidRow[]; gold: boolean }) {
  const yard = rows.find((r) => r.id === "coin");
  const best = rows.filter((r) => r.id !== "coin").sort((a, b) => b.perTrade - a.perTrade)[0];
  return (
    <div className="mb-4 rounded-lg border border-border bg-card/60 p-3">
      <h3 className="text-sm font-bold">
        ⚡ Rapid fire: 2 trades every 3–5 seconds, no open limit
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Your plan run on live prices: each entry follows the last 3 seconds, opens 2 seconds later
        like a copied trade, pays Vantage&apos;s spread and closes at a small profit, its stop or
        its time limit. Money is at 0.01 lot a trade. It only goes on the copier once a version
        makes money after the spread over {RAPID_PROVEN_MIN.toLocaleString("en-GB")} trades and
        beats the coin flip.
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No rapid trades scored yet. They start within a few minutes of the lab running
          {gold ? " (gold only while Vantage has it open)" : ""}.
        </p>
      ) : (
        <>
          {best && (
            <p className="mt-2 text-sm">
              {best.proven ? (
                <span className="font-bold text-emerald-400">Proven: </span>
              ) : (
                <span className="font-bold text-amber-300">Not proven: </span>
              )}
              best so far is {best.label.toLowerCase()}: {best.winRate}% wins,{" "}
              <span className={best.perTrade > 0 ? "text-emerald-400" : "text-rose-400"}>
                {sp(best.perTrade)} spreads a trade ({usd(best.dollars)} over {best.n} trades)
              </span>
              {yard ? `; the coin flip makes ${sp(yard.perTrade)}` : ""}.
            </p>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2">Version</th>
                  <th className="pr-2 text-right">Trades</th>
                  <th className="pr-2 text-right">Wins</th>
                  <th className="pr-2 text-right">Per trade</th>
                  <th className="pr-2 text-right">Lately</th>
                  <th className="pr-2 text-right">Money (0.01 lot)</th>
                  <th className="pr-2 text-right">Most open</th>
                  <th className="text-right">Worst run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr key={r.id} className={r.proven ? "bg-emerald-500/10" : ""}>
                    <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
                    <td className="pr-2 text-right">{r.n}</td>
                    <td className="pr-2 text-right">{r.winRate}%</td>
                    <td
                      className={`pr-2 text-right font-bold ${r.perTrade > 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {sp(r.perTrade)}
                    </td>
                    <td
                      className={`pr-2 text-right ${r.lately > 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {sp(r.lately)}
                    </td>
                    <td
                      className={`pr-2 text-right ${r.dollars > 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {usd(r.dollars)}
                    </td>
                    <td className="pr-2 text-right">{r.peakOpen}</td>
                    <td className="text-right">{r.worstLossStreak} lost</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
