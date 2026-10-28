import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CandlestickChart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getMt5Status, saveMt5Settings } from "@/lib/mt5.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["mt5-status"];

/** Boss: auto-trading the Boss's own MT5 account, and the copy-trade link. */
export function Mt5Panel() {
  const qc = useQueryClient();
  const load = useServerFn(getMt5Status);
  const save = useServerFn(saveMt5Settings);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setLink(data?.copyLink ?? ""), [data?.copyLink]);

  async function update(values: { autotrade?: boolean; copyLink?: string }, done: string) {
    setBusy(true);
    try {
      await save({ data: values });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const money = (n?: number) =>
    n == null
      ? "—"
      : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <AdminSection
      icon={<CandlestickChart className="h-4 w-4 text-emerald-400" />}
      title="MT5 auto-trading"
      subtitle="Your own Vantage MT5 account takes every 70%+ gold and bitcoin alert at 0.01 lot, with the bot's stop loss and Quick Scalp as take profit. The copy bot announces each trade in the signals chat."
    >
      {isLoading || !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4 text-sm">
          {!data.configured ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
              Not connected yet. Add your Vantage MT5 account in the MetaApi dashboard, then save
              METAAPI_TOKEN and METAAPI_ACCOUNT_ID as secrets (and METAAPI_REGION if it isn't
              new-york).
            </p>
          ) : data.account ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="font-bold text-emerald-300">
                Connected{data.account.server ? ` · ${data.account.server}` : ""}
                {data.account.login ? ` · ${data.account.login}` : ""}
              </p>
              <p className="text-muted-foreground">
                Balance {money(data.account.balance)} · Equity {money(data.account.equity)}{" "}
                {data.account.currency ?? ""}
              </p>
            </div>
          ) : (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200">
              Can't reach the MT5 account ({data.accountError}). Check the account is deployed in
              MetaApi and the secrets are right.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div>
              <p className="font-bold text-foreground">Auto-trade the alerts</p>
              <p className="text-xs text-muted-foreground">
                Off by default. Real money: only switch on when you're happy.
              </p>
            </div>
            <Switch
              checked={data.autotrade}
              disabled={busy || !data.configured}
              onCheckedChange={(v) =>
                void update({ autotrade: v }, v ? "Auto-trading is ON" : "Auto-trading is off")
              }
              aria-label="Auto-trade the alerts"
            />
          </div>

          <div className="space-y-2">
            <label className="font-bold text-foreground" htmlFor="copy-link">
              Copy-trading link (Vantage / IB)
            </label>
            <div className="flex gap-2">
              <Input
                id="copy-link"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || link === (data.copyLink ?? "")}
                onClick={() => void update({ copyLink: link }, "Copy link saved")}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Shown as "📋 Copy my trades" on the copy bot's posts. Add the copy bot in Telegram →
              Worker Fleet with the "Copy trading" job, on the signals chat.
            </p>
          </div>

          <div>
            <p className="mb-2 font-bold text-foreground">Recent trades</p>
            {!data.tradesReady ? (
              <p className="text-muted-foreground">Apply the mt5_trades migration to start.</p>
            ) : !data.trades.length ? (
              <p className="text-muted-foreground">None yet.</p>
            ) : (
              <ul className="space-y-1">
                {data.trades.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1"
                  >
                    <span className="text-foreground">
                      {t.direction} {t.symbol} {t.volume} @ {t.entry}
                    </span>
                    <span
                      className={
                        t.status === "failed" || Number(t.profit) < 0
                          ? "text-rose-400"
                          : t.status === "closed"
                            ? "text-emerald-400"
                            : "text-muted-foreground"
                      }
                    >
                      {t.status === "closed"
                        ? `${Number(t.profit) >= 0 ? "+" : "−"}${money(Math.abs(Number(t.profit)))}`
                        : t.status}
                      {t.error ? ` · ${t.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
