import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, Pause, Send } from "lucide-react";
import signalsIcon from "@/assets/og-signals-480.webp";
import { cn } from "@/lib/utils";
import {
  BOARD_MARKETS,
  getBoardPrices,
  getSignalsBoard,
  type BoardFrame,
  type BoardPrices,
  type BoardRow,
} from "@/lib/signals-board.functions";
import type { SignalSummary } from "@/lib/trade-signal-context.server";

const GROUPS = ["All", "Metals", "Crypto", "Forex", "Indices"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_OF = Object.fromEntries(BOARD_MARKETS.map((m) => [m.code, m.group])) as Record<
  string,
  Exclude<Group, "All">
>;

/** Prices tick every few seconds; signals rebuild as the engine's cache refreshes. */
const PRICE_MS = 5_000;
const BOARD_MS: Record<BoardFrame, number> = { "1H": 60_000, "15M": 30_000 };

export function SignalsBoard() {
  const [frame, setFrame] = useState<BoardFrame>("1H");
  const [group, setGroup] = useState<Group>("All");
  const fetchBoard = useServerFn(getSignalsBoard);
  const fetchPrices = useServerFn(getBoardPrices);

  const board = useQuery({
    queryKey: ["signals-board", frame],
    queryFn: () => fetchBoard({ data: { frame } }),
    refetchInterval: BOARD_MS[frame],
    staleTime: 15_000,
  });
  const open = board.data?.open === true;
  const prices = useQuery({
    queryKey: ["signals-board-prices"],
    queryFn: () => fetchPrices(),
    refetchInterval: PRICE_MS,
    enabled: open,
  });

  if (board.data && !board.data.open) return <Closed />;

  const rows = board.data?.open ? board.data.rows : [];
  const shown = rows.filter((r) => group === "All" || GROUP_OF[r.code] === group);
  const trades = rows.filter((r) => r.ok && r.signal.verdict === "trade").length;

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-3 sm:px-4">
      <header className="relative overflow-hidden rounded-3xl border-2 border-emerald-500/50 bg-card shadow-glow">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(color-mix(in oklab, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--border) 60%, transparent) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
          <img
            src={signalsIcon}
            alt=""
            className="h-16 w-16 shrink-0 rounded-2xl border-2 border-emerald-500/70 object-cover shadow-lg sm:h-20 sm:w-20"
          />
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[0.7rem] font-black uppercase tracking-widest text-black shadow">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-black" /> Live
            </span>
            <h1 className="mt-1 truncate font-display text-3xl font-black uppercase italic leading-none tracking-tight drop-shadow sm:text-4xl">
              OG <span className="text-emerald-400">Signals</span>
            </h1>
            <p className="mt-1 truncate text-xs font-semibold text-foreground/85">
              {board.data?.open
                ? `${trades} setups live of ${rows.length} markets · prices every 5s`
                : "Reading the live charts…"}
            </p>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-5">
          <Segmented
            value={frame}
            options={["1H", "15M"]}
            onChange={(v) => setFrame(v as BoardFrame)}
            label="Timeframe"
          />
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {GROUPS.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                  group === g
                    ? "border-emerald-400 bg-emerald-500 text-black"
                    : "border-border bg-background/60 text-foreground/80 hover:border-emerald-400/60",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </header>

      {board.data?.open && board.data.staffOnly && (
        <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300">
          OG Signals is switched off for members. You can see it because you're staff; turn it on in
          Boss → 0G B0T → Signals.
        </p>
      )}

      {board.isLoading ? (
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          <Loader2 className="mb-3 h-6 w-6 animate-spin" />
          Pulling live charts for {BOARD_MARKETS.length} markets…
        </div>
      ) : board.isError ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Couldn't load the signals just now. They'll retry on their own.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((row) => (
            <SignalCard key={row.code} row={row} prices={prices.data} />
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Built from live charts by the same engine as 0G B0T's Telegram signals. Confidence is how
        strongly the indicators agree, not a win rate. Risk 1–2% per trade. Not financial advice.
      </p>
      <div className="mt-3 flex justify-center">
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 px-4 py-2 text-sm font-bold text-foreground hover:bg-emerald-500/10"
        >
          <Send className="h-4 w-4" /> Get signals followed up on Telegram
        </Link>
      </div>
    </div>
  );
}

function Closed() {
  return (
    <div className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
      <img src={signalsIcon} alt="" className="mb-4 h-28 w-28 rounded-3xl opacity-80" />
      <Lock className="mb-2 h-5 w-5 text-muted-foreground" />
      <h1 className="text-xl font-black">OG Signals is switched off right now</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check back soon.</p>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-full border border-border bg-background/60 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-3.5 py-1 text-xs font-black transition-colors",
            value === o ? "bg-foreground text-background" : "text-foreground/70",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** The price to show: spot when the market has one, else the feed plus the chart shift. */
function livePriceFor(s: SignalSummary, prices: BoardPrices | undefined): number {
  const p = prices?.[s.market as keyof BoardPrices];
  if (p?.spot != null && s.offset) return p.spot;
  if (p?.feed != null) return p.feed + s.offset;
  return s.price;
}

function SignalCard({ row, prices }: { row: BoardRow; prices: BoardPrices | undefined }) {
  const label = BOARD_MARKETS.find((m) => m.code === row.code)?.code ?? row.code;
  if (!row.ok) {
    return (
      <article className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-black">{label}</h2>
        <p className="mt-2 text-sm text-muted-foreground">No live chart right now. Retrying…</p>
      </article>
    );
  }
  return <LiveCard s={row.signal} price={livePriceFor(row.signal, prices)} />;
}

/** One market's signal with its live price (exported for previews). */
export function LiveCard({ s, price }: { s: SignalSummary; price: number }) {
  const fmt = (n: number) =>
    n.toLocaleString("en-GB", {
      minimumFractionDigits: s.decimals,
      maximumFractionDigits: s.decimals,
      useGrouping: false,
    });
  const move = (from: number, to: number) => {
    const d = Math.abs(to - from);
    return s.pip ? `${(d / s.pip).toFixed(0)} pips` : `${fmt(d)}`;
  };
  // Flash the price green or red when it ticks.
  const prev = useRef(price);
  const [tick, setTick] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (price === prev.current) return;
    setTick(price > prev.current ? "up" : "down");
    prev.current = price;
    const t = setTimeout(() => setTick(null), 900);
    return () => clearTimeout(t);
  }, [price]);

  const buy = s.direction === "BUY";
  const wait = s.verdict === "wait";
  const validTill = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(s.validUntil)),
    [s.validUntil],
  );
  // How far price has gone from the stop (0) to TP1 (1), either direction.
  const span = s.targets[0] - s.stop;
  const progress = span ? Math.min(1, Math.max(0, (price - s.stop) / span)) : 0.5;
  const entryHow =
    s.entryType === "limit"
      ? "limit, wait for pullback"
      : s.entryType === "stop"
        ? "on a break"
        : "market";

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-card",
        wait ? "border-border" : buy ? "border-emerald-500/50" : "border-rose-500/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-black leading-tight">{s.label}</h2>
          <p className="text-xs text-muted-foreground">
            {s.timeframe} · {s.confidencePct}% · {s.quality}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black",
            wait
              ? "bg-muted text-foreground/80"
              : buy
                ? "bg-emerald-500 text-black"
                : "bg-rose-500 text-white",
          )}
        >
          {wait ? <Pause className="h-3 w-3" /> : null}
          {wait ? "WAIT" : s.direction}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-2xl font-black tabular-nums transition-colors duration-700",
            tick === "up"
              ? "text-emerald-400"
              : tick === "down"
                ? "text-rose-400"
                : "text-foreground",
          )}
        >
          {fmt(price)}
        </span>
        {s.changePct != null && (
          <span
            className={cn(
              "text-xs font-bold",
              s.changePct >= 0 ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {s.changePct >= 0 ? "+" : ""}
            {s.changePct.toFixed(2)}% today
          </span>
        )}
      </div>

      {wait ? (
        <div className="mt-3 space-y-1 text-sm">
          <p className="font-semibold">No trade right now</p>
          <p className="text-muted-foreground">{s.waitReason}</p>
          <p className="text-xs text-muted-foreground">Leaning {s.direction}.</p>
        </div>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Entry</dt>
            <dd className="font-mono font-bold tabular-nums">{fmt(s.entry)}</dd>
            <dd className="text-right text-xs text-muted-foreground">{entryHow}</dd>
            <dt className="text-muted-foreground">SL</dt>
            <dd className="font-mono font-bold tabular-nums text-rose-400">{fmt(s.stop)}</dd>
            <dd className="text-right text-xs text-muted-foreground">{move(s.entry, s.stop)}</dd>
            {s.targets.map((t, i) => (
              <Target key={i} n={i + 1} value={fmt(t)} rr={s.rrs[i]} />
            ))}
          </dl>
          <div className="mt-3">
            <div className="flex justify-between text-[0.65rem] font-bold uppercase text-muted-foreground">
              <span>SL</span>
              <span>TP1</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  buy ? "bg-emerald-500" : "bg-rose-500",
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-3 space-y-1 text-xs">
        {s.trends.length > 0 && (
          <p className="font-semibold text-foreground/85">📊 {s.trends.join("  ")}</p>
        )}
        {s.cautions.slice(0, 2).map((c) => (
          <p key={c} className="text-amber-300">
            ⚠️ {c}
          </p>
        ))}
        {!wait && <p className="text-muted-foreground">❌ Cancel if {s.cancelIf}</p>}
        {s.tested && <p className="text-muted-foreground">🧪 {s.tested}</p>}
        <p className="text-muted-foreground">⏳ Valid till {validTill} UK</p>
      </div>
    </article>
  );
}

function Target({ n, value, rr }: { n: number; value: string; rr?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">TP{n}</dt>
      <dd className="font-mono font-bold tabular-nums text-emerald-400">{value}</dd>
      <dd className="text-right text-xs text-muted-foreground">{rr}</dd>
    </>
  );
}
