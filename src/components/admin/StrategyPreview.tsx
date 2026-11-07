import { useState } from "react";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  buildPlan,
  framesFor,
  parseInstrument,
  sessionRead,
  type CandleSets,
} from "@/lib/trade-signal";
import { BACKTEST_FRAMES, fetchBinanceHistory, historyNeeded } from "@/lib/trade-signal-backtest";
import type { SignalStrategy } from "@/lib/signal-strategies";

const MARKET: Record<string, { symbol: string; ask: string; label: string }> = {
  BTCUSD: { symbol: "BTCUSDT", ask: "btc", label: "Bitcoin" },
  XAUUSD: { symbol: "PAXGUSDT", ask: "gold", label: "Gold" },
};
// Enough recent history for the engine, kept small so the preview is quick.
const PREVIEW_DAYS: Record<string, number> = { "1H": 60, "15M": 20, "5M": 10, "1M": 5 };

type Plan = ReturnType<typeof buildPlan>;
type Preview = {
  points: { t: number; price: number }[];
  plan: Plan;
  label: string;
  decimals: number;
};

const fmt = (n: number, dp: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function StrategyPreview({ strategy }: { strategy: SignalStrategy }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function run() {
    setState("loading");
    setMsg("");
    setPreview(null);
    try {
      const market = MARKET[strategy.market] ?? MARKET.BTCUSD;
      const cfg = BACKTEST_FRAMES[strategy.frame];
      const to = Date.now();
      const { need } = historyNeeded(strategy.frame, PREVIEW_DAYS[strategy.frame] ?? 20, to);
      const sets: CandleSets = { daily: [], hourly: [], fifteen: [], five: [], minute: [] };
      for (const [key, from] of Object.entries(need) as [keyof CandleSets, number][]) {
        sets[key] = await fetchBinanceHistory(market.symbol, key, from, to);
      }
      const { frames, entryCandles, middleCandles } = framesFor(sets, cfg.style, cfg.fast);
      const [hi, mid, lo] = frames;
      if (!hi || !mid || !lo || entryCandles.length < 30) {
        setState("error");
        setMsg("Not enough live data to project right now. Try again in a moment.");
        return;
      }
      const inst = parseInstrument(market.ask) ?? undefined;
      const plan = buildPlan(hi, mid, lo, entryCandles, middleCandles, undefined, {
        tuning: strategy.tuning,
        session: inst ? sessionRead(inst, to) : undefined,
      });
      const last = entryCandles.at(-1)?.c ?? plan.entry;
      const decimals = last >= 1000 ? 0 : last >= 10 ? 2 : 3;
      const points = entryCandles.slice(-80).map((c) => ({ t: c.t, price: c.c }));
      setPreview({ points, plan, label: market.label, decimals });
      setState("idle");
    } catch (e) {
      setState("error");
      setMsg((e as Error).message || "Couldn't build the preview.");
    }
  }

  const p = preview?.plan;
  const dp = preview?.decimals ?? 2;
  const levels = p
    ? [
        { y: p.entry, label: "Entry", color: "#f5b547" },
        { y: p.stop, label: "Stop", color: "#f26d6d" },
        ...p.targets.map((t, i) => ({ y: t, label: `TP${i + 1}`, color: "#4ade80" })),
      ]
    : [];
  const allY = preview ? [...preview.points.map((x) => x.price), ...levels.map((l) => l.y)] : [];
  const lo = allY.length ? Math.min(...allY) : 0;
  const hi = allY.length ? Math.max(...allY) : 1;
  const pad = (hi - lo) * 0.04 || 1;
  const isBuy = p?.direction === "BUY";

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          Projected trade on the {preview?.label ?? MARKET[strategy.market]?.label ?? "Bitcoin"}{" "}
          chart
        </span>
        <Button size="sm" variant="outline" onClick={run} disabled={state === "loading"}>
          {state === "loading" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LineChartIcon className="mr-2 h-4 w-4" />
          )}
          {preview ? "Refresh" : "Run on live price"}
        </Button>
      </div>

      {state === "error" ? <p className="mt-3 text-sm text-rose-300">{msg}</p> : null}

      {p ? (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className={isBuy ? "font-bold text-emerald-400" : "font-bold text-rose-400"}>
              {p.direction}
            </span>
            <span className="text-muted-foreground">
              {p.verdict === "trade" ? "Setup" : "Wait"} · {p.quality} · {p.confidencePct}%
              confidence
            </span>
            <span className="text-foreground">Entry {fmt(p.entry, dp)}</span>
            <span className="text-foreground">Stop {fmt(p.stop, dp)}</span>
            <span className="text-foreground">
              TP {p.targets.map((t) => fmt(t, dp)).join(" / ")}
            </span>
            <span className="text-muted-foreground">RR {p.rr}</span>
          </div>
          {p.verdict === "wait" ? (
            <p className="mt-1 text-xs text-amber-300">
              No clean setup on the live price right now — the levels are shown for reference.
              {p.waitReason ? ` ${p.waitReason}` : ""}
            </p>
          ) : null}

          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={preview!.points} margin={{ top: 6, right: 56, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="stratPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickFormatter={(t: number) =>
                    new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                  }
                  minTickGap={40}
                />
                <YAxis
                  domain={[lo - pad, hi + pad]}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  width={64}
                  tickFormatter={(v: number) => fmt(v, dp)}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{
                    background: "#0b1021",
                    border: "1px solid #ffffff22",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(t) => new Date(t as number).toLocaleString("en-GB")}
                  formatter={(v: number) => [fmt(v, dp), "Price"]}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#cbd5e1"
                  strokeWidth={1.5}
                  fill="url(#stratPrice)"
                  isAnimationActive={false}
                />
                {levels.map((l) => (
                  <ReferenceLine
                    key={l.label}
                    y={l.y}
                    stroke={l.color}
                    strokeDasharray={l.label === "Entry" ? undefined : "5 4"}
                    label={{ value: l.label, position: "right", fill: l.color, fontSize: 10 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            Projection from the live {preview!.label} price using this strategy's settings. It's an
            illustration, not a trade that was sent.
          </p>
        </>
      ) : state !== "loading" && state !== "error" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Run it to project this strategy's next entry, stop and take-profits on the live chart.
        </p>
      ) : null}
    </div>
  );
}
