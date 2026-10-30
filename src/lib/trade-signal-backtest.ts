// Replays the signal engine over past candles to measure how its signals
// would actually have done: each step takes only the candles that had
// closed by then, builds the same plan a member would have got, and follows
// it with the tracker's own rules (trade-signal-outcome.ts). Pure apart from
// fetchBinanceHistory, so it runs in the Boss's browser and in tests.
import { volumeRatio } from "./trade-signal-extras";
import { findSetups, type SetupHit } from "./trade-setups";
import { advanceSignal, targetsReached, type SignalStatus } from "./trade-signal-outcome";
import {
  DEFAULT_TUNING,
  buildPlan,
  framesFor,
  sessionRead,
  validityWindow,
  type Candle,
  type CandleSets,
  type FastFrame,
  type Instrument,
  type Style,
  type TradePlan,
} from "./trade-signal";

export type BacktestFrame = "1H" | "15M" | "5M" | "1M";

/** How each signal timeframe maps onto the engine (same as live signals). */
export const BACKTEST_FRAMES: Record<
  BacktestFrame,
  { style: Style; fast?: FastFrame; entry: keyof CandleSets; ms: number; step: number }
> = {
  // step: how many entry candles between simulated requests (about hourly
  // for the short frames, every other hour for 1H).
  "1H": { style: "intraday", entry: "hourly", ms: 3600_000, step: 2 },
  "15M": { style: "scalp", entry: "fifteen", ms: 900_000, step: 4 },
  "5M": { style: "scalp", fast: "5m", entry: "five", ms: 300_000, step: 12 },
  "1M": { style: "scalp", fast: "1m", entry: "minute", ms: 60_000, step: 15 },
};

/** Candles kept per timeframe at each step, matching what live signals load. */
const WINDOW: Record<keyof CandleSets, number> = {
  daily: 365,
  hourly: 1000,
  fifteen: 500,
  five: 500,
  minute: 500,
};
const FRAME_MS: Record<keyof CandleSets, number> = {
  daily: 86_400_000,
  hourly: 3600_000,
  fifteen: 900_000,
  five: 300_000,
  minute: 60_000,
};

export type BacktestTrade = {
  /** When the simulated signal was made (ms). */
  t: number;
  direction: TradePlan["direction"];
  confidence: TradePlan["confidence"];
  confidencePct: number;
  verdict: TradePlan["verdict"];
  entryType: TradePlan["entryType"];
  status: SignalStatus;
  /** Targets reached (0–3). */
  best: number;
  entered: boolean;
  /** Result in R (risk units), taking a third off at each target and the stop to entry after TP1. */
  r: number;
};

/** Index of the first candle at or after `t` (candles sorted by time). */
function firstAtOrAfter(cs: Candle[], t: number): number {
  let lo = 0;
  let hi = cs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The candles that had closed by `t`, at most the live window. */
function closedBy(sets: CandleSets, key: keyof CandleSets, t: number): Candle[] {
  const cs = sets[key];
  const end = firstAtOrAfter(cs, t - FRAME_MS[key] + 1);
  return cs.slice(Math.max(0, end - WINDOW[key]), end);
}

/** R made by a finished trade (see BacktestTrade.r). */
export function tradeR(
  plan: Pick<TradePlan, "direction" | "entry" | "stop" | "targets">,
  status: SignalStatus,
  best: number,
  lastPrice: number,
): number {
  const risk = Math.abs(plan.entry - plan.stop);
  if (!(risk > 0)) return 0;
  const sign = plan.direction === "BUY" ? 1 : -1;
  const inR = (px: number) => ((px - plan.entry) * sign) / risk;
  if (status === "stopped") return -1;
  let r = 0;
  for (let k = 0; k < best; k++) r += inR(plan.targets[k]) / 3;
  const left = (3 - best) / 3;
  if (status === "expired" || status === "cancelled") {
    // What's left is closed at the last price, but never below the stop's
    // level (at entry once TP1 is in).
    const floor = best >= 1 ? 0 : -1;
    r += left * Math.max(floor, Number.isFinite(lastPrice) ? inR(lastPrice) : 0);
  }
  // breakeven: the rest closes at entry (0); tp3: nothing left.
  return r;
}

/**
 * Simulated signals for every `step` entry candles between `from` and `to`,
 * each followed on the entry-timeframe candles until it ends or expires.
 * When one candle touches both the stop and a target, the stop counts, so
 * results lean cautious. Yields to the browser now and then via `onProgress`.
 */
export async function runBacktest(opts: {
  sets: CandleSets;
  frame: BacktestFrame;
  from: number;
  to: number;
  inst?: Instrument;
  classic?: boolean;
  step?: number;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}): Promise<BacktestTrade[]> {
  const cfg = BACKTEST_FRAMES[opts.frame];
  const entrySeries = opts.sets[cfg.entry];
  const step = opts.step ?? cfg.step;
  const startIdx = firstAtOrAfter(entrySeries, opts.from);
  const endIdx = firstAtOrAfter(entrySeries, opts.to);
  const hours = validityWindow(cfg.style, 0).hours;
  const trades: BacktestTrade[] = [];
  const total = Math.max(0, Math.ceil((endIdx - startIdx) / step));
  let done = 0;
  for (let i = startIdx; i < endIdx; i += step) {
    // The signal is made as entry candle i closes.
    const t = entrySeries[i].t + cfg.ms;
    const sets: CandleSets = {
      daily: closedBy(opts.sets, "daily", t),
      hourly: closedBy(opts.sets, "hourly", t),
      fifteen: cfg.style === "scalp" ? closedBy(opts.sets, "fifteen", t) : [],
      five: cfg.fast === "5m" ? closedBy(opts.sets, "five", t) : [],
      minute: cfg.fast === "1m" ? closedBy(opts.sets, "minute", t) : [],
    };
    const expiresAt = t + hours * 3600_000;
    const pathStart = firstAtOrAfter(entrySeries, t);
    const pathEnd = firstAtOrAfter(entrySeries, expiresAt);
    // Only judge signals whose whole window is in the data.
    if (pathEnd >= entrySeries.length) break;
    const { frames, entryCandles, middleCandles } = framesFor(sets, cfg.style, cfg.fast);
    const [hi, mid, lo] = frames;
    done++;
    if (done % 40 === 0) await opts.onProgress?.(done, total);
    if (!hi || !mid || !lo) continue;
    const plan = buildPlan(hi, mid, lo, entryCandles, middleCandles, undefined, {
      classic: opts.classic,
      volumeRatio: volumeRatio(entryCandles),
      session: opts.inst ? sessionRead(opts.inst, t) : undefined,
    });
    const path = entrySeries.slice(pathStart, pathEnd);
    const result = advanceSignal(
      {
        direction: plan.direction,
        entryType: plan.entryType === "stop" ? "stop" : "limit",
        entry: plan.entry,
        stop: plan.stop,
        targets: [plan.targets[0], plan.targets[1], plan.targets[2]],
        status: plan.entryType === "market" ? "open" : "pending",
        expiresAt,
      },
      path,
      expiresAt,
    );
    const best = Math.max(0, ...result.events.map((e) => targetsReached(e.kind as SignalStatus)));
    const entered = plan.entryType === "market" || result.events.some((e) => e.kind === "filled");
    const last = path.length ? path[path.length - 1].c : NaN;
    trades.push({
      t,
      direction: plan.direction,
      confidence: plan.confidence,
      confidencePct: plan.confidencePct,
      verdict: plan.verdict,
      entryType: plan.entryType,
      status: result.status,
      best,
      entered,
      r: entered ? tradeR(plan, result.status, best, last) : 0,
    });
  }
  await opts.onProgress?.(total, total);
  return trades;
}

/**
 * One past setup for the learning loop (signal-learning.server.ts): the
 * engine's own levels before any tuning, and the candles that followed, so
 * other stop and target settings can be tried on exactly the same setup.
 */
export type LearnSample = {
  t: number;
  direction: TradePlan["direction"];
  entry: number;
  entryType: TradePlan["entryType"];
  confidencePct: number;
  /** The engine's verdict with no confidence floor applied. */
  verdict: TradePlan["verdict"];
  raw: TradePlan["raw"];
  path: Candle[];
  expiresAt: number;
  /** The extra chart setups showing at the same moment (trade-setups.ts). */
  setups?: SetupHit[];
};

/** Past setups every `step` entry candles between `from` and `to` (see LearnSample). */
export function collectSamples(opts: {
  sets: CandleSets;
  frame: BacktestFrame;
  from: number;
  to: number;
  inst?: Instrument;
  step?: number;
}): LearnSample[] {
  const cfg = BACKTEST_FRAMES[opts.frame];
  const entrySeries = opts.sets[cfg.entry];
  const step = opts.step ?? cfg.step;
  const hours = validityWindow(cfg.style, 0).hours;
  const out: LearnSample[] = [];
  for (
    let i = firstAtOrAfter(entrySeries, opts.from);
    i < firstAtOrAfter(entrySeries, opts.to);
    i += step
  ) {
    const t = entrySeries[i].t + cfg.ms;
    const sets: CandleSets = {
      daily: closedBy(opts.sets, "daily", t),
      hourly: closedBy(opts.sets, "hourly", t),
      fifteen: cfg.style === "scalp" ? closedBy(opts.sets, "fifteen", t) : [],
      five: cfg.fast === "5m" ? closedBy(opts.sets, "five", t) : [],
      minute: cfg.fast === "1m" ? closedBy(opts.sets, "minute", t) : [],
    };
    const expiresAt = t + hours * 3600_000;
    const pathEnd = firstAtOrAfter(entrySeries, expiresAt);
    if (pathEnd >= entrySeries.length) break;
    const { frames, entryCandles, middleCandles } = framesFor(sets, cfg.style, cfg.fast);
    const [hi, mid, lo] = frames;
    if (!hi || !mid || !lo) continue;
    const plan = buildPlan(hi, mid, lo, entryCandles, middleCandles, undefined, {
      volumeRatio: volumeRatio(entryCandles),
      session: opts.inst ? sessionRead(opts.inst, t) : undefined,
      tuning: { ...DEFAULT_TUNING, minConfidence: 0 },
    });
    out.push({
      t,
      direction: plan.direction,
      entry: plan.entry,
      entryType: plan.entryType,
      confidencePct: plan.confidencePct,
      verdict: plan.verdict,
      raw: plan.raw,
      path: entrySeries.slice(firstAtOrAfter(entrySeries, t), pathEnd),
      expiresAt,
      setups: findSetups(entryCandles, hi.bias),
    });
  }
  return out;
}

export type BandStats = { n: number; tp1: number };

export type BacktestSummary = {
  /** Signals made (including ones marked wait). */
  signals: number;
  /** Signals the engine would have sent as trades. */
  taken: number;
  /** Taken signals whose entry filled. */
  filled: number;
  /** Of those, how many reached TP1. */
  tp1: number;
  /** Stopped out before TP1. */
  stopped: number;
  /** Average R per filled trade. */
  avgR: number;
  /** Filled trades by confidence band. */
  bands: Record<TradePlan["confidence"], BandStats>;
};

/** Totals for the trades the engine would have sent (verdict "trade"). */
export function summarise(trades: BacktestTrade[]): BacktestSummary {
  const taken = trades.filter((t) => t.verdict === "trade");
  const filled = taken.filter((t) => t.entered);
  const bands: BacktestSummary["bands"] = {
    High: { n: 0, tp1: 0 },
    Medium: { n: 0, tp1: 0 },
    Low: { n: 0, tp1: 0 },
  };
  for (const t of filled) {
    bands[t.confidence].n++;
    if (t.best >= 1) bands[t.confidence].tp1++;
  }
  return {
    signals: trades.length,
    taken: taken.length,
    filled: filled.length,
    tp1: filled.filter((t) => t.best >= 1).length,
    stopped: filled.filter((t) => t.status === "stopped").length,
    avgR: filled.length ? filled.reduce((a, t) => a + t.r, 0) / filled.length : 0,
    bands,
  };
}

/* ── Saved results (site_content "signals.backtest.<market>.<frame>") ─── */

export type SavedBacktest = {
  v: 1;
  market: string;
  frame: BacktestFrame;
  days: number;
  /** When the tested period ended (ms). */
  to: number;
  filled: number;
  tp1: number;
  avgR: number;
  bands: BacktestSummary["bands"];
};

export const backtestKey = (market: string, frame: string) => `signals.backtest.${market}.${frame}`;

/** Fewer filled trades than this and a hit rate isn't worth quoting. */
export const MIN_CALIBRATION_TRADES = 20;

export function parseSavedBacktest(value: string | null | undefined): SavedBacktest | null {
  try {
    const v = JSON.parse(value ?? "") as SavedBacktest;
    return v?.v === 1 && v.bands && Number.isFinite(v.filled) ? v : null;
  } catch {
    return null;
  }
}

/**
 * One honest line for a live card: how signals at this confidence did in the
 * saved backtest, or overall when the band is too small. Null when there's
 * too little data.
 */
export function calibrationLine(
  saved: SavedBacktest | null,
  confidence: TradePlan["confidence"],
): string | null {
  if (!saved) return null;
  const band = saved.bands[confidence];
  const [n, hits, who] =
    band && band.n >= MIN_CALIBRATION_TRADES
      ? [band.n, band.tp1, `${confidence}-confidence signals`]
      : [saved.filled, saved.tp1, "Signals like this"];
  if (n < MIN_CALIBRATION_TRADES) return null;
  return `Backtest, ${saved.days} days: ${who} hit TP1 ${Math.round((hits / n) * 100)}% of the time (${n} trades)`;
}

/* ── Browser data: Binance's public market-data mirror ─────────────────── */

const BINANCE_INTERVAL: Record<keyof CandleSets, string> = {
  daily: "1d",
  hourly: "1h",
  fifteen: "15m",
  five: "5m",
  minute: "1m",
};

/** Binance's public market-data mirror first, then its main API. */
const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

/** Binance's USDⓈ-M futures API (perpetuals such as the gold one, XAUUSDT). */
const BINANCE_FUTURES_KLINES = "https://fapi.binance.com/fapi/v1/klines";

/**
 * Every candle from `start` to `end` for a Binance spot symbol, 1000 at a
 * time; with `futures`, for a USDⓈ-M perpetual instead.
 */
export async function fetchBinanceHistory(
  symbol: string,
  key: keyof CandleSets,
  start: number,
  end: number,
  fetcher: typeof fetch = fetch,
  opts: { futures?: boolean } = {},
): Promise<Candle[]> {
  const out: Candle[] = [];
  let from = start;
  let host = 0;
  const hosts = opts.futures
    ? [BINANCE_FUTURES_KLINES]
    : BINANCE_HOSTS.map((h) => `${h}/api/v3/klines`);
  for (let page = 0; page < 400 && from < end; page++) {
    const url =
      `${hosts[host]}?symbol=${symbol}` +
      `&interval=${BINANCE_INTERVAL[key]}&startTime=${from}&endTime=${end}&limit=1000`;
    const res = await fetcher(url).catch(() => null);
    if (!res?.ok) {
      // Switch host once and retry the same page.
      if (host + 1 < hosts.length) {
        host++;
        page--;
        continue;
      }
      throw new Error(`Binance ${res?.status ?? "unreachable"}`);
    }
    const rows = (await res.json()) as unknown[][];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        t: Number(r[0]),
        o: +String(r[1]),
        h: +String(r[2]),
        l: +String(r[3]),
        c: +String(r[4]),
        v: +String(r[5]),
      });
    }
    const next = Number(rows[rows.length - 1][0]) + FRAME_MS[key];
    if (next <= from) break;
    from = next;
  }
  return out;
}

/** How much history each timeframe needs for a test of `days` ending at `end`. */
export function historyNeeded(frame: BacktestFrame, days: number, end: number) {
  const cfg = BACKTEST_FRAMES[frame];
  const start = end - days * 86_400_000;
  // Warm-up so the first simulated signal sees full live-sized windows.
  const warm = (key: keyof CandleSets) => start - WINDOW[key] * FRAME_MS[key];
  const need: Partial<Record<keyof CandleSets, number>> = {
    daily: warm("daily"),
    hourly: warm("hourly"),
  };
  if (cfg.style === "scalp") need.fifteen = warm("fifteen");
  if (cfg.fast === "5m") need.five = warm("five");
  if (cfg.fast === "1m") need.minute = warm("minute");
  return { start, need };
}
