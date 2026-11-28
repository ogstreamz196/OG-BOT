import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CandlestickChart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectMt5Account,
  disconnectMt5Account,
  getMt5Link,
  getMt5Status,
  saveMt5Settings,
} from "@/lib/mt5.functions";
import { BROKERS, brokerById } from "@/lib/mt5-brokers";
import { AdminSection } from "./AdminSection";
import { SIGNAL_MARKETS } from "@/lib/signal-markets";

const KEY = ["mt5-status"];

/**
 * Connects the Boss's MT5 account online (no PC): demo first, live only after typing LIVE. The password
 * goes straight to MetaApi once and is never kept.
 */
function ConnectAccount() {
  const qc = useQueryClient();
  const readLink = useServerFn(getMt5Link);
  const connect = useServerFn(connectMt5Account);
  const disconnect = useServerFn(disconnectMt5Account);
  const { data, isLoading } = useQuery({ queryKey: ["mt5-link"], queryFn: () => readLink() });
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [login, setLogin] = useState("");
  const [brokerId, setBrokerId] = useState("vantage");
  const [server, setServer] = useState(BROKERS[0]?.servers[0] ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const r = await connect({ data: { mode, login, server, password, confirm } });
      if (r.ok) {
        setPassword("");
        setConfirm("");
        toast.success(`${mode === "live" ? "Live" : "Demo"} account connected. The signals group now shows it.`, {
          description: "It can take a minute for MetaApi to start the account. The status above turns to connected when it's ready.",
        });
        await qc.invalidateQueries({ queryKey: ["mt5-link"] });
        await qc.invalidateQueries({ queryKey: KEY });
      } else {
        setError(r.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!window.confirm("Unlink this account from the bot? Trades stop until you connect one again.")) return;
    setBusy(true);
    try {
      await disconnect();
      await qc.invalidateQueries({ queryKey: ["mt5-link"] });
      toast.success("Account unlinked");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="font-semibold">Connect your MT5 account</p>
      {data.linked ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <p className="font-bold text-emerald-300">
            {data.mode === "live" ? "Live" : "Demo"} account linked · {data.server} · {data.login}
          </p>
          <p className="text-muted-foreground">
            MetaApi status: {data.state}
            {data.connection && data.connection !== "unknown" ? ` · connection ${data.connection}` : ""}
          </p>
          <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={onDisconnect}>
            Unlink account
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No account linked. Connect a demo account first and check it trades, then connect the live one.
        </p>
      )}
      <div className="flex gap-2">
        {(["demo", "live"] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
            {m === "demo" ? "Demo account" : "Live account"}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Broker</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            value={brokerId}
            onChange={(e) => {
              setBrokerId(e.target.value);
              setServer(brokerById(e.target.value)?.servers[0] ?? "");
            }}
          >
            {BROKERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <Input placeholder="Account number (login)" inputMode="numeric" value={login} onChange={(e) => setLogin(e.target.value.replace(/\D/g, ""))} />
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Server (from your MT5 login screen)</span>
          <Input list="mt5-servers" placeholder="e.g. Vantage-Demo" value={server} onChange={(e) => setServer(e.target.value)} />
          <datalist id="mt5-servers">
            {(brokerById(brokerId)?.servers ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <Input type="password" autoComplete="off" placeholder="Account password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === "live" ? (
          <Input placeholder="Type LIVE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        The password is sent once to MetaApi to create the cloud account. The site doesn't keep it.
      </p>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <Button disabled={busy || !login || !server || !password} onClick={onConnect}>
        {busy ? "Connecting…" : `Connect ${mode === "live" ? "live" : "demo"} account`}
      </Button>
    </div>
  );
}

/** Boss: auto-trading the Boss's own MT5 account, and the copy-trade link. */
export function Mt5Panel() {
  const qc = useQueryClient();
  const load = useServerFn(getMt5Status);
  const save = useServerFn(saveMt5Settings);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const [link, setLink] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setLink(data?.copyLink ?? ""), [data?.copyLink]);
  useEffect(() => setFee(String(data?.commissionPerLot ?? 0)), [data?.commissionPerLot]);

  async function update(
    values: { autotrade?: boolean; copyLink?: string; commissionPerLot?: number },
    done: string,
  ) {
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
      subtitle="Your own Vantage MT5 account takes every 70%+ bitcoin alert at 0.01 lot, with the bot's stop loss and Quick Scalp as take profit. The copy bot announces each trade in the signals chat."
    >
      <ConnectAccount />
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

          <div className="space-y-2">
            <label className="font-bold text-foreground" htmlFor="mt5-fee">
              Commission per lot (USD, round turn)
            </label>
            <div className="flex gap-2">
              <Input
                id="mt5-fee"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !Number.isFinite(Number(fee)) ||
                  Number(fee) < 0 ||
                  Number(fee) > 100 ||
                  Number(fee) === (data.commissionPerLot ?? 0)
                }
                onClick={() => void update({ commissionPerLot: Number(fee) }, "Commission saved")}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              0 on a Vantage Standard STP account (the cost is in the spread). On Raw ECN or Pro
              ECN, enter what Vantage charges per 1.0 lot for opening and closing together. The bot
              counts it on every trade when it learns.
            </p>
            <p className="text-xs text-muted-foreground">
              Vantage spread measured by the bot:{" "}
              {SIGNAL_MARKETS.map((mk) => {
                const s = data.spread?.[mk];
                const dp = 1;
                const label = "bitcoin";
                return s?.latest != null
                  ? `${label} ${s.latest.toFixed(dp)} now${s.usual != null ? `, usually ${s.usual.toFixed(dp)} at this hour` : ""}`
                  : `${label} not measured yet`;
              }).join(" · ")}
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
