import { useState } from "react";
import { FlaskConical, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminSection } from "./AdminSection";
import { parseInstrument } from "@/lib/trade-signal";
import {
  backtestKey,
  fetchBinanceHistory,
  historyNeeded,
  MIN_CALIBRATION_TRADES,
  runBacktest,
  summarise,
  type BacktestFrame,
  type BacktestSummary,
  type SavedBacktest,
} from "@/lib/trade-signal-backtest";
import type { CandleSets } from "@/lib/trade-signal";

// The markets the Telegram picker offers, tested on Binance's free history
// (gold through the PAX Gold token that live gold signals are charted from).
const MARKETS = {
  XAUUSD: { label: "Gold", symbol: "PAXGUSDT", ask: "gold" },
  BTCUSD: { label: "Bitcoin", symbol: "BTCUSDT", ask: "btc" },
} as const;
type Market = keyof typeof MARKETS;

const DAYS: Record<BacktestFrame, number[]> = {
  "1H": [90, 180, 365],
  "15M": [30, 90, 180],
  "1M": [7, 14],
};

type Result = {
  market: Market;
  frame: BacktestFrame;
  days: number;
  to: number;
  current: BacktestSummary;
  classic: BacktestSummary;
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

export function SignalsBacktestPanel() {
  const [market, setMarket] = useState<Market>("XAUUSD");
  const [frame, setFrame] = useState<BacktestFrame>("15M");
  const [days, setDays] = useState(90);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function pickFrame(next: BacktestFrame) {
    setFrame(next);
    if (!DAYS[next].includes(days)) setDays(DAYS[next][0]);
  }

  async function run() {
    setError(null);
    setSaved(null);
    setResult(null);
    try {
      const m = MARKETS[market];
      const to = Date.now();
      const { start, need } = historyNeeded(frame, days, to);
      const sets: CandleSets = { daily: [], hourly: [], fifteen: [], minute: [] };
      for (const [key, from] of Object.entries(need) as [keyof CandleSets, number][]) {
        setProgress(`Downloading ${key} candles…`);
        sets[key] = await fetchBinanceHistory(m.symbol, key, from, to);
      }
      const inst = parseInstrument(m.ask) ?? undefined;
      const tick = (label: string) => async (done: number, total: number) => {
        setProgress(`${label}: ${done} of ${total} signals`);
        // Let the page repaint between batches.
        await new Promise((r) => setTimeout(r, 0));
      };
      const current = await runBacktest({
        sets,
        frame,
        from: start,
        to,
        inst,
        onProgress: tick("New rules"),
      });
      const classic = await runBacktest({
        sets,
        frame,
        from: start,
        to,
        inst,
        classic: true,
        onProgress: tick("Old rules"),
      });
      setResult({
        market,
        frame,
        days,
        to,
        current: summarise(current),
        classic: summarise(classic),
      });
    } catch (e) {
      setError(
        `Couldn't finish the backtest: ${(e as Error).message}. Binance's free data may be busy, try again in a minute.`,
      );
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!result) return;
    const s = result.current;
    const value: SavedBacktest = {
      v: 1,
      market: result.market,
      frame: result.frame,
      days: result.days,
      to: result.to,
      filled: s.filled,
      tp1: s.tp1,
      avgR: Math.round(s.avgR * 100) / 100,
      bands: s.bands,
    };
    const { error: err } = await supabase.rpc("set_site_content", {
      p_key: backtestKey(result.market, result.frame),
      p_value: JSON.stringify(value),
    });
    setSaved(
      err
        ? `Couldn't save: ${err.message}`
        : "Saved. New signal cards will quote it within 10 minutes.",
    );
  }

  const busy = progress !== null;
  return (
    <AdminSection
      icon={<FlaskConical className="h-5 w-5 text-primary" />}
      title="Signal backtest"
      subtitle="Replays the signal engine over past prices and follows every signal the way the bot does. Runs in your browser on Binance's free data."
    >
      <div className="space-y-3">
        <Picker
          label="Market"
          value={market}
          options={(Object.keys(MARKETS) as Market[]).map((k) => [k, MARKETS[k].label])}
          onChange={(v) => setMarket(v as Market)}
        />
        <Picker
          label="Timeframe"
          value={frame}
          options={(["1H", "15M", "1M"] as BacktestFrame[]).map((f) => [f, f])}
          onChange={(v) => pickFrame(v as BacktestFrame)}
        />
        <Picker
          label="Days"
          value={String(days)}
          options={DAYS[frame].map((d) => [String(d), `${d}`])}
          onChange={(v) => setDays(Number(v))}
        />
        <Button onClick={run} disabled={busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {busy ? progress : "Run backtest"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {result && (
        <div className="mt-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium" />
                  <th className="py-1 pr-3 font-medium">New rules</th>
                  <th className="py-1 font-medium">Old rules</th>
                </tr>
              </thead>
              <tbody>
                {rows(result).map(([label, now, before]) => (
                  <tr key={label} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
                    <td className="py-1.5 pr-3 font-semibold">{now}</td>
                    <td className="py-1.5">{before}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">New rules by confidence</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {(["High", "Medium", "Low"] as const).map((band) => {
                const b = result.current.bands[band];
                return (
                  <div key={band} className="rounded-xl border border-border/60 p-2">
                    <div className="text-muted-foreground">{band}</div>
                    <div className="font-semibold">{pct(b.tp1, b.n)} TP1</div>
                    <div className="text-xs text-muted-foreground">{b.n} trades</div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            R is profit in units of the risk taken: a third off at each target, stop to entry after
            TP1. When a candle touches the stop and a target together, the stop counts, so these
            results lean cautious. Past results don't promise future ones.
          </p>

          <div className="space-y-1">
            <Button
              variant="secondary"
              onClick={save}
              disabled={result.current.filled < MIN_CALIBRATION_TRADES}
              className="w-full sm:w-auto"
            >
              <Save className="mr-2 h-4 w-4" />
              Show this on live {MARKETS[result.market].label} {result.frame} signals
            </Button>
            {result.current.filled < MIN_CALIBRATION_TRADES && (
              <p className="text-xs text-muted-foreground">
                Needs at least {MIN_CALIBRATION_TRADES} filled trades to quote. Try more days.
              </p>
            )}
            {saved && <p className="text-sm text-muted-foreground">{saved}</p>}
          </div>
        </div>
      )}
    </AdminSection>
  );
}

function rows(r: Result): [string, string, string][] {
  const line = (f: (s: BacktestSummary) => string): [string, string] => [
    f(r.current),
    f(r.classic),
  ];
  return [
    ["Signals checked", ...line((s) => String(s.signals))],
    ["Sent as trades", ...line((s) => `${s.taken} (${pct(s.taken, s.signals)})`)],
    ["Entries filled", ...line((s) => String(s.filled))],
    ["Hit TP1", ...line((s) => pct(s.tp1, s.filled))],
    ["Stopped before TP1", ...line((s) => pct(s.stopped, s.filled))],
    ["Average per trade", ...line((s) => `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R`)],
  ];
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm text-muted-foreground">{label}</span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v)}
        className="flex-wrap justify-start"
      >
        {options.map(([v, text]) => (
          <ToggleGroupItem key={v} value={v} size="sm">
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
