// Gives OG Bot live market data when a user asks for a trade signal on a
// pair. Prices come from free public feeds (Binance and Kraken for crypto and
// gold, Yahoo Finance for forex, indices, oil and stocks); indicators and the
// trade plan are computed in code (trade-signal.ts) so the bot quotes real
// numbers instead of guessing.
import {
  type CalendarEvent,
  type CryptoFlow,
  cryptoFlowRead,
  newsRisk,
  parseBinanceTicker,
  parseCalendar,
  parseFunding,
  parseKrakenTicker,
  parseOpenInterestChange,
  parseSwissquoteMid,
  parseYahooPrice,
  shiftCandles,
  spotGap,
  volumeNote,
  volumeRatio,
} from "./trade-signal-extras";
import { calibrationLine } from "./trade-signal-backtest";
import type { DeskDecision } from "./signal-desk.server";
import { CARD_LOT, lotMoney } from "./trade-bias";
import {
  adjustConfidence,
  dollarRead,
  flowRead as takerFlow,
  flowVerdict,
  goldVerdict,
  type CheckVerdict,
} from "./pair-checks";
import {
  DEFAULT_TUNING,
  NO_TIME_LIMIT,
  roundStepFor,
  aggregate,
  buildPlan,
  decimalsFor,
  detectStyle,
  detectTradeIntent,
  fastFrame,
  framesFor,
  readFrame,
  sessionRead,
  type Candle,
  type EntryType,
  type FastFrame,
  type FrameRead,
  type Instrument,
  validityWindow,
  type Style,
} from "./trade-signal";

export type Interval = "1m" | "5m" | "15m" | "1h" | "1d";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; OGBot/1.0)" };
const TIMEOUT_MS = 3500;
/** Start the next source if the current one hasn't answered by now. */
const HEDGE_MS = 900;
const NEWS_TIMEOUT_MS = 2500;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const clean = (cs: Candle[]) =>
  cs.filter((c) => [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0));

/** Binance's main API, then its public market-data mirror (not region-blocked). */
const BINANCE_HOSTS = {
  Binance: "https://api.binance.com",
  "Binance data": "https://data-api.binance.vision",
} as const;

async function fromBinance(
  symbol: string,
  interval: Interval,
  limit: number,
  host: string = BINANCE_HOSTS.Binance,
): Promise<Candle[]> {
  const rows = (await getJson(
    `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )) as unknown[][];
  return clean(
    rows.map((r) => ({
      t: Number(r[0]),
      o: +String(r[1]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
      v: +String(r[5]),
      // Taker (aggressive) buy volume, for the order-flow check.
      ...(r[9] != null && Number.isFinite(+String(r[9])) ? { tb: +String(r[9]) } : {}),
    })),
  );
}

/** Binance's USDⓈ-M futures API (the gold perpetual, XAUUSDT). */
export const FUTURES_SOURCE = "Binance futures";

async function fromBinanceFutures(
  symbol: string,
  interval: Interval,
  limit: number,
): Promise<Candle[]> {
  const rows = (await getJson(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )) as unknown[][];
  return clean(
    rows.map((r) => ({
      t: Number(r[0]),
      o: +String(r[1]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
      v: +String(r[5]),
      // Taker (aggressive) buy volume, for the order-flow check.
      ...(r[9] != null && Number.isFinite(+String(r[9])) ? { tb: +String(r[9]) } : {}),
    })),
  );
}

async function fromKraken(pair: string, interval: Interval): Promise<Candle[]> {
  const mins = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440 }[interval];
  const json = (await getJson(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${mins}`,
  )) as { error?: string[]; result?: Record<string, unknown> };
  if (json.error?.length) throw new Error(json.error.join(", "));
  const key = Object.keys(json.result ?? {}).find((k) => k !== "last");
  const rows = (key ? json.result?.[key] : []) as unknown[][];
  return clean(
    rows.map((r) => ({
      t: Number(r[0]) * 1000,
      o: +String(r[1]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
      v: +String(r[6]),
    })),
  );
}

async function fromYahoo(symbol: string, interval: Interval): Promise<Candle[]> {
  const range = { "1m": "1d", "5m": "5d", "15m": "5d", "1h": "60d", "1d": "1y" }[interval];
  const json = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
  )) as {
    chart?: {
      result?: {
        timestamp?: number[];
        indicators?: {
          quote?: {
            open?: number[];
            high?: number[];
            low?: number[];
            close?: number[];
            volume?: number[];
          }[];
        };
      }[];
    };
  };
  const r = json.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error("no chart data");
  return clean(
    r.timestamp.map((t, i) => ({
      t: t * 1000,
      o: q.open?.[i] ?? NaN,
      h: q.high?.[i] ?? NaN,
      l: q.low?.[i] ?? NaN,
      c: q.close?.[i] ?? NaN,
      v: q.volume?.[i] ?? undefined,
    })),
  );
}

// Warm caches shared by every request on this server instance.
const CANDLE_TTL: Record<Interval, number> = {
  "1d": 10 * 60_000,
  "1h": 60_000,
  "15m": 30_000,
  "5m": 15_000,
  "1m": 10_000,
};
const candleCache = new Map<
  string,
  { exp: number; at: number; value: { data: Candle[]; source: string } }
>();
const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/**
 * A cached chart is stale once a new candle has closed since it was fetched:
 * the scan right after a 5-minute close reads the closed candle, not the
 * chart from a few seconds before it. Pure, so it can be tested.
 */
export function cachedChartFresh(
  hit: { exp: number; at: number },
  interval: Interval,
  now: number,
): boolean {
  const ms = INTERVAL_MS[interval];
  return hit.exp > now && Math.floor(hit.at / ms) === Math.floor(now / ms);
}
const inflight = new Map<string, Promise<{ data: Candle[]; source: string }>>();
/** Sources that refused us (e.g. a region block) are skipped for a while. */
const sourceDownUntil = new Map<string, number>();

function markDown(source: string, e: unknown) {
  const status = (e as { status?: number }).status;
  if (status === 451 || status === 403 || status === 429) {
    sourceDownUntil.set(source, Date.now() + (status === 429 ? 2 : 30) * 60_000);
  }
}

/**
 * Hedged fetch: sources are tried in preference order, but the next one
 * starts if the current one is slow, and the first good answer in preference
 * order wins. Results are cached per market and timeframe.
 */
export async function candles(
  inst: Instrument,
  interval: Interval,
): Promise<{ data: Candle[]; source: string }> {
  const key = `${inst.code}:${interval}`;
  const hit = candleCache.get(key);
  if (hit && cachedChartFresh(hit, interval, Date.now())) return hit.value;
  const running = inflight.get(key);
  if (running) return running;

  const limit = interval === "1d" ? 365 : interval === "1h" ? 1000 : 500;
  const tries: [string, () => Promise<Candle[]>][] = [];
  const { binance, kraken, yahoo, futures } = inst;
  // The real market's perpetual first (gold), then the proxy token.
  if (futures) tries.push([FUTURES_SOURCE, () => fromBinanceFutures(futures, interval, limit)]);
  if (binance) {
    tries.push(["Binance", () => fromBinance(binance, interval, limit)]);
    tries.push([
      "Binance data",
      () => fromBinance(binance, interval, limit, BINANCE_HOSTS["Binance data"]),
    ]);
  }
  if (kraken) tries.push(["Kraken", () => fromKraken(kraken, interval)]);
  if (yahoo) tries.push(["Yahoo Finance", () => fromYahoo(yahoo, interval)]);
  const live = tries.filter(([src]) => (sourceDownUntil.get(src) ?? 0) < Date.now());
  const order = live.length ? live : tries;

  const job = (async () => {
    const results: Promise<Candle[] | null>[] = [];
    const start = (i: number) => {
      const [source, run] = order[i];
      results[i] = run()
        .then((d) => (d.length >= 60 ? d : null))
        .catch((e) => {
          markDown(source, e);
          console.warn(`[trade] ${source} ${inst.code} ${interval} failed:`, (e as Error).message);
          return null;
        });
      return results[i];
    };
    for (let i = 0; i < order.length; i++) {
      const p = start(i);
      // Wait for this source, but no longer than the hedge delay before
      // starting the next one (unless it's the last).
      const settled = await Promise.race([
        p.then((d) => ({ done: true as const, d })),
        new Promise<{ done: false }>((r) =>
          setTimeout(
            () => r({ done: false }),
            i === order.length - 1 ? TIMEOUT_MS + 500 : HEDGE_MS,
          ),
        ),
      ]);
      if (settled.done && settled.d) return { data: settled.d, source: order[i][0] };
    }
    // Everything has started; take the first good answer in preference order.
    for (let i = 0; i < results.length; i++) {
      const d = await results[i];
      if (d) return { data: d, source: order[i][0] };
    }
    return { data: [] as Candle[], source: "" };
  })();

  inflight.set(key, job);
  try {
    const value = await job;
    if (value.data.length)
      candleCache.set(key, { exp: Date.now() + CANDLE_TTL[interval], at: Date.now(), value });
    return value;
  } finally {
    inflight.delete(key);
  }
}

const newsCache = new Map<string, { exp: number; value: string | null }>();

async function marketNews(inst: Instrument): Promise<string | null> {
  if (!inst.yahoo) return null;
  const hit = newsCache.get(inst.code);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fetchNews(inst.yahoo);
  newsCache.set(inst.code, { exp: Date.now() + (value ? 10 : 2) * 60_000, value });
  return value;
}

/** Top 3 Yahoo Finance headlines for the market. Soft-fails to null. */
async function fetchNews(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=3&quotesCount=0`,
      { headers: UA, signal: AbortSignal.timeout(NEWS_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as {
      news?: { title?: string; publisher?: string; providerPublishTime?: number }[];
    };
    const items = (json.news ?? []).filter((n) => n.title).slice(0, 3);
    if (!items.length) return null;
    return items
      .map((n, i) => {
        const when = n.providerPublishTime
          ? ` (${new Date(n.providerPublishTime * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC)`
          : "";
        return `${i + 1}. ${n.title}${n.publisher ? `, ${n.publisher}` : ""}${when}`;
      })
      .join("\n");
  } catch {
    return null;
  }
}

/**
 * The trend on the frame above a signal's entry timeframe (the one its
 * "cancel early if" line watches): 1M and 5M → 1H, 15M → 4H, 1H → Daily,
 * 4H → Weekly.
 */
export async function higherTrend(
  inst: Instrument,
  timeframe: string,
): Promise<FrameRead["bias"] | null> {
  if (timeframe === "1M" || timeframe === "5M" || timeframe === "15M") {
    const hourly = await candles(inst, "1h");
    return timeframe === "15M"
      ? (readFrame("4H", aggregate(hourly.data, 4))?.bias ?? null)
      : (readFrame("1H", hourly.data)?.bias ?? null);
  }
  const daily = await candles(inst, "1d");
  return (
    readFrame(
      timeframe === "4H" ? "Weekly" : "Daily",
      timeframe === "4H" ? aggregate(daily.data, 24 * 7) : daily.data,
    )?.bias ?? null
  );
}

/* ── Live price, calendar and crypto positioning (all soft-fail) ─────── */

const liveCache = new Map<string, { exp: number; value: number }>();

/**
 * The latest traded price, fresher than the last candle close. Tried in the
 * same source order as the candles; NaN when none answers quickly.
 */
export async function livePrice(inst: Instrument): Promise<number> {
  const hit = liveCache.get(inst.code);
  if (hit && hit.exp > Date.now()) return hit.value;
  const tries: [string, () => Promise<number>][] = [];
  if (inst.binance) {
    const s = inst.binance;
    for (const [source, host] of Object.entries(BINANCE_HOSTS)) {
      tries.push([
        source,
        async () => parseBinanceTicker(await getJson(`${host}/api/v3/ticker/price?symbol=${s}`)),
      ]);
    }
  }
  if (inst.kraken) {
    const k = inst.kraken;
    tries.push([
      "Kraken",
      async () =>
        parseKrakenTicker(await getJson(`https://api.kraken.com/0/public/Ticker?pair=${k}`)),
    ]);
  }
  if (inst.yahoo) {
    const y = inst.yahoo;
    tries.push([
      "Yahoo Finance",
      async () =>
        parseYahooPrice(
          await getJson(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1m&range=1d`,
          ),
        ),
    ]);
  }
  // All sources at once; the first in preference order to answer within
  // LIVE_MS wins. A slow feed never holds the signal up.
  const running = tries
    .filter(([source]) => (sourceDownUntil.get(source) ?? 0) <= Date.now())
    .map(([source, run]) =>
      run().catch((e) => {
        markDown(source, e);
        return NaN;
      }),
    );
  const deadline = new Promise<number>((r) => setTimeout(() => r(NaN), LIVE_MS));
  for (const job of running) {
    const value = await Promise.race([job, deadline]);
    if (Number.isFinite(value) && value > 0) {
      liveCache.set(inst.code, { exp: Date.now() + 5_000, value });
      return value;
    }
  }
  return NaN;
}

const spotCache = new Map<string, { exp: number; value: number }>();

/**
 * Spot price brokers quote (Swissquote's free feed) for markets charted from
 * a proxy, e.g. gold from the PAX Gold token. NaN when unavailable.
 */
/** Where each market's last spot price came from ("vantage" or "swissquote"). */
export const spotSource = new Map<string, "vantage" | "swissquote">();
/** The markets Vantage (through MetaApi) can price. */
export const BROKER_MARKETS = new Set(["XAUUSD", "BTCUSD"]);

export async function spotPrice(inst: Instrument): Promise<number> {
  // Vantage's own price first (the Boss's broker, through MetaApi), so every
  // level is on the price members trade; Swissquote when that's not set up.
  if (BROKER_MARKETS.has(inst.code)) {
    const { brokerQuote } = await import("./broker-quotes.server");
    const q = await brokerQuote(inst.code).catch(() => null);
    if (q) {
      spotSource.set(inst.code, "vantage");
      return q.mid;
    }
  }
  if (!inst.spot) return NaN;
  spotSource.set(inst.code, "swissquote");
  const hit = spotCache.get(inst.spot);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await getJson(
    `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${inst.spot}`,
  )
    .then(parseSwissquoteMid)
    .catch(() => NaN);
  spotCache.set(inst.spot, { exp: Date.now() + (Number.isFinite(value) ? 15_000 : 60_000), value });
  return value;
}

/** The extra reads are nice to have: none may delay a signal by more than this. */
const LIVE_MS = 1200;
const EXTRA_MS = 1500;
function soft<T>(job: Promise<T>, fallback: T, ms = EXTRA_MS): Promise<T> {
  return Promise.race([
    job.catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

/** Over this many times the usual spread for the hour, scalps sit it out. */
export const SPREAD_GUARD = 2;

/** A reason to sit out when Vantage's spread right now is blown out, else null. Never throws. */
async function spreadBlownOut(market: string): Promise<string | null> {
  if (!BROKER_MARKETS.has(market)) return null;
  try {
    const bq = await import("./broker-quotes.server");
    const [q, model] = await Promise.all([bq.brokerQuote(market), bq.spreadModel()]);
    const usual = bq.typicalSpread(model, market, Date.now());
    if (!q || !usual || q.spread <= usual * SPREAD_GUARD) return null;
    const dp = market === "BTCUSD" ? 1 : 2;
    return `Vantage's spread is blown out right now (${q.spread.toFixed(dp)} against a usual ${usual.toFixed(dp)}), so I'm sitting it out.`;
  } catch {
    return null;
  }
}

/** The US 10-year Treasury yield (Yahoo), for gold's dollar check. */
const US10Y: Instrument = {
  label: "US 10-year yield",
  code: "US10Y",
  asset: "index",
  yahoo: "^TNX",
};

/** Closed hourly EUR/USD and US 10-year yield candles, for gold's dollar check (pair-checks.ts). */
async function dollarCandles(): Promise<{ eurusd: Candle[]; yields: Candle[] } | null> {
  const eur = detectTradeIntent("EURUSD signal 1h");
  if (!eur) return null;
  const [e, y] = await Promise.all([
    candles(eur, "1h"),
    candles(US10Y, "1h").catch(() => ({ data: [] as Candle[], source: "" })),
  ]);
  const closed = (cs: Candle[]) => cs.filter((c) => c.t + 3_600_000 <= Date.now());
  return { eurusd: closed(e.data), yields: closed(y.data) };
}

let calendarCache: { exp: number; value: CalendarEvent[] } | null = null;

/** This week's economic calendar (free Forex Factory feed), cached for an hour. */
export async function economicCalendar(): Promise<CalendarEvent[]> {
  if (calendarCache && calendarCache.exp > Date.now()) return calendarCache.value;
  try {
    const value = parseCalendar(
      await getJson("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
    );
    calendarCache = { exp: Date.now() + (value.length ? 60 : 10) * 60_000, value };
    return value;
  } catch {
    calendarCache = { exp: Date.now() + 10 * 60_000, value: [] };
    return [];
  }
}

const flowCache = new Map<string, { exp: number; value: CryptoFlow | null }>();

/** Binance futures funding and open interest for a crypto market. */
async function cryptoFlow(inst: Instrument): Promise<CryptoFlow | null> {
  if (inst.asset !== "crypto" || !inst.binance) return null;
  const hit = flowCache.get(inst.code);
  if (hit && hit.exp > Date.now()) return hit.value;
  const s = inst.binance;
  const [funding, oi] = await Promise.all([
    getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`)
      .then(parseFunding)
      .catch(() => NaN),
    getJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${s}&period=1h&limit=25`)
      .then(parseOpenInterestChange)
      .catch(() => NaN),
  ]);
  const value =
    Number.isFinite(funding) || Number.isFinite(oi) ? { funding, oiChange24h: oi } : null;
  flowCache.set(inst.code, { exp: Date.now() + (value ? 2 : 10) * 60_000, value });
  return value;
}

/**
 * Where a signal's prices come from: the chart feeds, plus `offset` when the
 * chart was shifted onto the spot price (the tracker shifts its candles the
 * same way) and `entry: "stop"` for confirmation entries (stored as pending
 * like a limit, but filled when price breaks through).
 */
/** A 5-minute scalp's learned time limits, for feeds (none when they're off). */
function timeLimitFeeds(entryLabel: string, t: { holdFor: number; fillWithin: number }) {
  if (entryLabel !== "5M") return {};
  return {
    ...(t.holdFor < NO_TIME_LIMIT ? { holdFor: t.holdFor } : {}),
    ...(t.fillWithin < NO_TIME_LIMIT ? { fillWithin: t.fillWithin } : {}),
  };
}

export type SignalFeeds = {
  /** The test account's lot on this alert, and once it's over what it made (paper-account.server.ts). */
  paper?: { lots: number; pnl?: number; balance?: number; why?: string };
  /** Older signals: the learned breakeven, stop to entry once this many risks in profit. */
  beAt?: number;
  /** The profit lock (PROFIT_LOCK): 70% of the way to TP1, the stop moves to 30% of the way. */
  lock?: boolean;
  /** The take profit it was sent with, once it's been moved (tpMove). */
  tp0?: number;
  /**
   * An open take profit with a trailing stop (TRAIL): the first risk, and
   * where the trailing stop is now once it has started.
   */
  trail?: { risk: number; stop?: number; said?: number };
  /** Each take profit move, oldest first. */
  tpMoves?: { kind: "extend" | "pull"; from: number; to: number; at: string }[];
  /** The stop has moved (the profit lock, or an older breakeven, fired). */
  protected?: boolean;
  /** The learned-off filter that let this signal through (signal-filter-learning.server.ts). */
  relaxed?: string;
  /** What the live-trial pair checks said (pair-checks.ts): gold's dollar, bitcoin's flow. */
  checks?: { dollar?: "with" | "against" | "flat"; flow?: "with" | "against" | "flat" };
  /** Minutes a filled trade gets before it's closed on time (learned; absent = the whole validity). */
  holdFor?: number;
  /** Minutes a pending entry waits to fill (learned; absent = the whole validity). */
  fillWithin?: number;
  /** What the AI desk said about an auto-posted alert (the Boss's report groups by it). */
  desk?: "backed" | "no_ai" | "unanimous";
  /** The extra chart setup that made it, when one did (trade-setups.ts). */
  setup?: string;
  /** The real market's perpetual (gold's XAUUSDT), tried first by the tracker. */
  futures?: string;
  binance?: string;
  kraken?: string;
  yahoo?: string;
  offset?: number;
  entry?: "stop";
  /** A market-bias call (no clean setup): never counts in the results book. */
  bias?: boolean;
  /** Who asked for it, so a win can be announced to them by name. */
  requester?: { id: number; name: string };
  /** The "entry not reached" notice, so the next one can replace it. */
  notice?: number;
  /** The trade's journal: each update, timed, written into the card itself. */
  log?: string[];
  /** The spot quote a proxy chart (gold) follows, so the tracker can re-check the gap. */
  spot?: string;
};

/** What a "no signal" card says: one of these, picked at random. */
export const NO_SIGNAL_LINES = [
  "Fuck all worth trading right now. Come back later.",
  "Chart's a dog's dinner. No signal, keep your money in your pocket.",
  "Nothing. Nada. Sit on your hands, you impatient bastard.",
  "Market's doing fuck all useful. No trade, try later.",
  "No setup, no signal. Don't force it, you degenerate.",
  "Chop city. I'm not handing you a signal just to watch you get rinsed.",
  "Bugger all here. Check back in a bit.",
  "No clean trade. Put the phone down and touch some grass.",
];

export const MARKET_SHUT_LINE = "Market's shut, you muppet. No signal till it opens.";

/**
 * The last line of every signal card. Educational, never advice: OG B0T is
 * showing its own trade, so it never tells anyone how much to risk or to copy.
 */
export const SIGNAL_DISCLAIMERS = [
  "educational, my own trade, not advice",
  "my own trade, for learning, not advice",
  "educational only, not financial advice",
  "learn from it, don't copy it blindly",
  "a trade journal, not a tip",
  "my trade, my risk, not advice",
];

/** What a sent signal needs for outcome tracking (see trade-signal-tracker.server.ts). */
export type SignalPlan = {
  market: string;
  label: string;
  feeds: SignalFeeds;
  style: Style;
  timeframe: string;
  direction: "BUY" | "SELL";
  entry: number;
  entryType: EntryType;
  stop: number;
  targets: [number, number, number];
  confidencePct: number;
  quality: "Clean" | "Mixed" | "Choppy";
  decimals: number;
  pip: number | null;
  expiresAt: string;
};

/** The signal as data, for the OG Signals page (the same numbers as the card). */
export type SignalSummary = {
  market: string;
  label: string;
  timeframe: string;
  verdict: "trade" | "wait";
  waitReason?: string;
  direction: "BUY" | "SELL";
  confidencePct: number;
  confidence: "Low" | "Medium" | "High";
  quality: "Clean" | "Mixed" | "Choppy";
  entry: number;
  entryType: EntryType;
  stop: number;
  targets: number[];
  /** Risk:reward per target, e.g. ["1:1", "1:2", "1:3.4"]. */
  rrs: string[];
  /** Price when the signal was built. */
  price: number;
  /** Change since yesterday's close, %. */
  changePct: number | null;
  /** Added to the chart feed's price to reach spot (gold, silver), else 0. */
  offset: number;
  /** e.g. ["4H ↓", "1H ↓", "15M ↑"]. */
  trends: string[];
  cautions: string[];
  cancelIf: string;
  validUntil: string;
  decimals: number;
  pip: number | null;
  source: string;
  /** Saved backtest line, when the Boss has saved one. */
  tested: string | null;
  builtAt: string;
};

type TradeSignalResult = {
  block: string;
  expiresAt: string | null;
  reply: string;
  plan?: SignalPlan;
  summary?: SignalSummary;
  /** No clean setup: the risky market-bias call from the highs and lows. */
  bias?: SignalPlan;
  biasReply?: string;
  /** What the bias read needs, so the desk can ask for the other side. */
  biasArgs?: BiasArgs;
  /** The safe band the take profit can sit in (close to TP1), for the desk to pick from. */
  tpRange?: { lo: number; hi: number; quick: number };
  /** The same signal with another take profit (inside tpRange). */
  retarget?: (tp: number) => { reply: string; plan: SignalPlan };
};

/**
 * What Telegram sends for a request: the signal when there is one, else the
 * market-bias call, else the plain "no signal" card. `plan` is what to follow.
 */
export function cardToSend(s: TradeSignalResult): { reply: string; plan?: SignalPlan } {
  if (s.plan) return { reply: s.reply, plan: s.plan };
  if (s.bias && s.biasReply) return { reply: s.biasReply, plan: s.bias };
  return { reply: s.reply };
}
const cache = new Map<string, TradeSignalResult & { exp: number; at?: number }>();

function frameLine(f: FrameRead, fmt: (n: number) => string): string {
  const e200 = Number.isFinite(f.ema200) ? `, 200 EMA ${fmt(f.ema200)}` : "";
  return `${f.name}: ${f.bias} (close ${fmt(f.close)}, 20 EMA ${fmt(f.ema20)}, 50 EMA ${fmt(f.ema50)}${e200}), RSI ${f.rsi.toFixed(0)}, ATR ${fmt(f.atr)}, MACD histogram ${f.macdHist >= 0 ? "+" : "−"} and ${f.macdRising ? "rising" : "falling"}`;
}

const HOW_TO_ANSWER = `TRADE SIGNAL MODE — the user wants a trade call. Rules:
- The user has already had an instant "hold on, checking the charts" message. Don't repeat that; open straight with the signal card.
- Use ONLY the prices, levels, confidence and times in the LIVE MARKET DATA block. Copy them exactly; never invent, round differently or "adjust" a price, stop, target, percentage or time.
- If the Verdict is WAIT, say plainly there's no trade right now and why, name the side it leans, and suggest asking again later. Don't present the entry, stop or targets as a trade to take.
- Otherwise always give the most likely direction. Lay it out as a clean signal card first (plain lines, no tables, no markdown headers):
  📊 PAIR — BUY or SELL
  Confidence: …% (Low/Medium/High)
  Entry: … (say if it's market or a pullback limit)
  SL: … (distance in pips/points if given)
  TP: … (one take profit)
  R:R: …
  ⏳ Valid until: … (UK time) — say plainly that after this time the signal is stale and they should ask you again, and that an unfilled pullback entry should be cancelled by then.
  Then 2–4 short lines on WHY (trend across timeframes, momentum, the key level), what would cancel it early, and any news risk from the headlines given.
- Give the Setup quality next to the confidence. For each CAUTION line, say it briefly in plain words (mixed timeframes, no clean setup, big news due, crowded futures) and that they should go smaller or wait.
- If a HIGH-IMPACT NEWS list is given, name those events and times. If a TRACK RECORD line is given, quote it exactly; never make one up.
- Explain that the confidence is how strongly the indicators agree, not a guaranteed win rate.
- Keep your usual voice for the commentary, but the numbers stay serious and exact.
- End with ONE short line saying it's educational, not financial advice. Don't lecture beyond that.
- Never claim a win rate, guarantee, or that you "know" where price is going.`;

const NO_DATA = (inst: Instrument) =>
  `TRADE SIGNAL MODE — the user asked about ${inst.label}, but live prices could not be loaded right now. Tell them straight that you can't pull a live chart for ${inst.label} this second, so you won't make up entry, stop or target levels. Offer a general read only if you're sure of it, and ask them to try again in a minute. Never invent current prices.`;

/**
 * Prompt block for a trade-signal question, or "" when the message isn't one.
 * Cached for 60s per market and style so a busy chat doesn't hammer the feeds.
 */
export async function buildTradeSignalContext(userText: string): Promise<string> {
  return (await buildTradeSignal(userText)).block;
}

/**
 * An ask that names no market: whichever of gold and bitcoin has the stronger
 * setup right now, as an ask naming it (gold when neither has one). Both
 * builds are cached, so building the winner again costs nothing.
 */
export async function bestMarketAsk(userText: string): Promise<string> {
  const asks = ["XAUUSD", "BTCUSD"].map((code) => `${code} signal ${userText}`);
  const built = await Promise.all(asks.map((ask) => buildTradeSignal(ask).catch(() => null)));
  const strength = (s: TradeSignalResult | null) => s?.plan?.confidencePct ?? -1;
  return strength(built[1]) > strength(built[0]) ? asks[1] : asks[0];
}

/**
 * The prompt block plus when the signal stops being valid (null when no
 * signal was built), so the app can expire it at exactly the stated time.
 */
export async function buildTradeSignal(userText: string): Promise<TradeSignalResult> {
  const inst = detectTradeIntent(userText);
  if (!inst) return { block: "", expiresAt: null, reply: "" };
  const style: Style = detectStyle(userText);
  const fast = fastFrame(userText);
  const entryIv: Interval = fast ?? (style === "scalp" ? "15m" : "1h");
  const entryLabel = fast
    ? fast.toUpperCase()
    : style === "scalp"
      ? "15M"
      : style === "swing"
        ? "4H"
        : "1H";
  // A strategy tried on purpose (random signals, signal-random.server.ts):
  // "setup:<id>" reads only that setup, proven or not. Members never send it.
  const forced = /\bsetup:([a-z_]+)\b/.exec(userText)?.[1];
  const key = `${inst.code}:${style}:${entryIv}${forced ? `:${forced}` : ""}`;
  const hit = cache.get(key);
  // Not past the close of a new entry candle, so a fresh setup is never hidden.
  if (hit && cachedChartFresh({ exp: hit.exp, at: hit.at ?? 0 }, entryIv, Date.now()))
    return {
      block: hit.block,
      expiresAt: hit.expiresAt,
      reply: hit.reply,
      plan: hit.plan,
      summary: hit.summary,
      bias: hit.bias,
      biasReply: hit.biasReply,
      biasArgs: hit.biasArgs,
      tpRange: hit.tpRange,
      retarget: hit.retarget,
    };

  const tracker = import("./trade-signal-tracker.server");
  // Gold reads the US dollar and yields alongside its own chart (pair-checks.ts).
  const dollarJob = inst.code === "XAUUSD" ? soft(dollarCandles(), null) : Promise.resolve(null);
  const [daily, hourly, fifteen, quick, news, feedPrice, calendar, flow, record, spot, saved] =
    await Promise.all([
      candles(inst, "1d"),
      candles(inst, "1h"),
      style === "scalp"
        ? candles(inst, "15m")
        : Promise.resolve({ data: [] as Candle[], source: "" }),
      // The 1- or 5-minute entry candles for a fast scalp.
      fast ? candles(inst, fast) : Promise.resolve({ data: [] as Candle[], source: "" }),
      marketNews(inst),
      livePrice(inst),
      soft(economicCalendar(), [] as CalendarEvent[]),
      soft(cryptoFlow(inst), null),
      soft(
        tracker.then((m) => m.trackRecord(inst.code, entryLabel)),
        null,
      ),
      soft(spotPrice(inst), NaN),
      soft(
        tracker.then((m) => m.savedBacktest(inst.code, entryLabel)),
        null,
      ),
    ]);

  // Proxy charts (gold token, silver futures) are moved onto the spot price
  // brokers quote, so every level matches what members see.
  // Gold can come from two feeds (the gold perpetual, or the PAX Gold token
  // if the perpetual is down), each with its own gap to spot, so every series
  // is moved by the gap of the feed it came from.
  const latest = (fromFutures: boolean) =>
    [quick, fifteen, hourly, daily]
      .find((x) => (x.source === FUTURES_SOURCE) === fromFutures && x.data.length)
      ?.data.at(-1)?.c ?? NaN;
  // The proxy token's price: its live ticker, else its freshest candle.
  const proxyNow = Number.isFinite(feedPrice) && feedPrice > 0 ? feedPrice : latest(false);
  const futuresNow = latest(true);
  const gapFor = (source: string) =>
    spotGap(spot, source === FUTURES_SOURCE ? futuresNow : proxyNow);
  const shifted = (x: { data: Candle[]; source: string }) =>
    shiftCandles(x.data, gapFor(x.source)?.offset ?? 0);
  // The entry chart's feed decides the signal's own gap (what the tracker follows).
  const entrySeries = fast ? quick : style === "scalp" ? fifteen : hourly;
  const entryGap = gapFor(entrySeries.source);
  const offset = entryGap?.offset ?? 0;
  const spotOk = !!entryGap;
  const live = spotOk
    ? spot
    : entrySeries.source === FUTURES_SOURCE && futuresNow > 0
      ? futuresNow
      : feedPrice;
  const dailyOnSpot = shifted(daily);
  const { frames, entryCandles, middleCandles } = framesFor(
    {
      daily: dailyOnSpot,
      hourly: shifted(hourly),
      fifteen: shifted(fifteen),
      five: fast === "5m" ? shifted(quick) : [],
      minute: fast === "1m" ? shifted(quick) : [],
    },
    style,
    fast,
  );

  const [hi, mid, lo] = frames;
  if (!hi || !mid || !lo) {
    const value = NO_DATA(inst);
    const result = {
      block: value,
      expiresAt: null,
      reply: `I can't pull a live chart for ${inst.label} right now, so I won't make up entry, stop or target levels. Try again in a minute.`,
    };
    cache.set(key, { exp: Date.now() + 30_000, at: Date.now(), ...result });
    return result;
  }

  // A proxy token's volume (PAX Gold) says nothing about the real market, so
  // it never counts there; the gold perpetual's volume is the real market's.
  const volume =
    inst.spot && entrySeries.source !== FUTURES_SOURCE ? NaN : volumeRatio(entryCandles);
  // What OG B0T has learned from past setups (stop room, target pull-in,
  // confidence floor); the hand-set rules until it has learned anything.
  const { learnedTuning } = await import("./signal-learning.server");
  const learned = await learnedTuning(inst.code).catch(() => undefined);
  // 1-minute signals (Boss-only) were the weakest live (1 won, 3 lost in a
  // month): they need ONE_MINUTE_MIN_CONFIDENCE or they're a wait.
  const tuning =
    fast === "1m"
      ? {
          ...(learned ?? DEFAULT_TUNING),
          minConfidence: Math.max(
            ONE_MINUTE_MIN_CONFIDENCE,
            (learned ?? DEFAULT_TUNING).minConfidence,
          ),
        }
      : learned;
  let plan = buildPlan(hi, mid, lo, entryCandles, middleCandles, live, {
    volumeRatio: volume,
    session: sessionRead(inst),
    roundStep: roundStepFor(inst.code),
    tuning,
  });
  // A proxy chart (gold from PAX Gold) without a confirmed spot price would
  // print the token's prices, not the real market's: no levels until it's back.
  const spotUnconfirmed = !!inst.spot && !spotOk;
  if (spotUnconfirmed && plan.verdict === "trade")
    plan = {
      ...plan,
      verdict: "wait",
      waitReason: `Can't confirm the real ${inst.label} price right now, so no levels.`,
    };
  // The filters learn too (signal-filter-learning.server.ts): one whose
  // blocked setups keep winning is switched off for this market, so its
  // setups trade, tagged, until they stop winning.
  const { relaxedFilters } = await import("./signal-filter-learning.server");
  const { waitReasonKind, SHADOW_REASONS } = await import("./signal-shadows.server");
  const relaxed = await relaxedFilters(inst.code).catch(() => new Set<string>());
  let relaxedBy: string | undefined;
  const waitKind =
    plan.verdict === "wait" && !spotUnconfirmed ? waitReasonKind(plan.waitReason) : null;
  if (waitKind && relaxed.has(waitKind as never)) {
    relaxedBy = waitKind;
    plan = {
      ...plan,
      verdict: "trade",
      waitReason: undefined,
      cautions: [
        `Normally I'd sit this one out (${SHADOW_REASONS[waitKind].toLowerCase()}), but lately those have been winning.`,
        ...plan.cautions,
      ],
    };
  }
  // Scalps sit out the moments that hurt them: the daily rollover, big US
  // news and gold's last hour before the weekend (blackout).
  const { blackout } = await import("./trade-signal-extras");
  const blackedOut = fast
    ? blackout(Date.now(), { gold: inst.code === "XAUUSD", news: calendar })
    : null;
  // Vantage's spread blown out (over twice its usual for this hour): no new scalps.
  const spreadNote = fast ? await spreadBlownOut(inst.code) : null;
  const sitOut = (blackedOut && !relaxed.has("blackout") ? blackedOut : null) ?? spreadNote;
  if (blackedOut && !sitOut && plan.verdict === "trade") relaxedBy ??= "blackout";
  if (sitOut && plan.verdict === "trade") plan = { ...plan, verdict: "wait", waitReason: sitOut };
  // No engine setup right now (and the market's open): on the 5-minute chart,
  // an extra setup the learning loop has proven for this market takes its place.
  if (forced) {
    // Only the one setup asked for, if it's showing on this chart right now.
    const { findSetups, setupPlan, SETUP_NAMES } = await import("./trade-setups");
    const { chartTrend } = await import("./signal-frame-setups.server");
    const closed = entryCandles.filter((c) => c.t + FRAME_MS[entryIv] <= Date.now());
    const trend = entryIv === "5m" ? hi.bias : chartTrend(closed);
    const open =
      SETUP_FRAMES.includes(entryIv) &&
      !spotUnconfirmed &&
      !/\bclosed\b/i.test(plan.waitReason ?? "");
    const hit = open ? findSetups(closed, trend).find((h) => h.id === forced) : undefined;
    const fromSetup = hit ? setupPlan(plan, hit, live, tuning ?? DEFAULT_TUNING) : null;
    plan = fromSetup ?? {
      ...plan,
      verdict: "wait",
      waitReason: `No ${SETUP_NAMES[forced as keyof typeof SETUP_NAMES] ?? "such setup"} showing`,
    };
  } else if (
    plan.verdict === "wait" &&
    SETUP_FRAMES.includes(entryIv) &&
    !spotUnconfirmed &&
    !sitOut &&
    !/\bclosed\b/i.test(plan.waitReason ?? "")
  ) {
    const { liveSetupStats, provenConfidence } = await import("./signal-learning.server");
    // Only setups proven on this very chart (the Boss's rule).
    const proven = await liveSetupStats(inst.code, entryIv).catch(
      () => ({}) as Record<string, never>,
    );
    if (Object.keys(proven).length) {
      const { findSetups, setupPlan } = await import("./trade-setups");
      const closed = entryCandles.filter((c) => c.t + FRAME_MS[entryIv] <= Date.now());
      const floor = tuning?.minConfidence ?? 0;
      // A proven setup is as sure as it has been accurate (its own win rate),
      // so only the accurate ones clear the alert bar. Fast scalps (wick
      // rejections, exhaustion reversals) come in here too.
      // The trend the proof used: the bigger timeframe on the 5-minute chart,
      // the chart's own moving averages on the others (chartTrend).
      const { chartTrend } = await import("./signal-frame-setups.server");
      const trend = entryIv === "5m" ? hi.bias : chartTrend(closed);
      const hit = findSetups(closed, trend)
        .filter((h) => h.id in proven)
        .map((h) => ({
          ...h,
          confidencePct: provenConfidence(h.confidencePct, proven[h.id as keyof typeof proven]),
        }))
        .sort((x, y) => y.confidencePct - x.confidencePct)
        .find((h) => h.confidencePct >= floor);
      const fromSetup = hit ? setupPlan(plan, hit, live, tuning ?? DEFAULT_TUNING) : null;
      if (fromSetup) plan = fromSetup;
    }
  }
  // Live trial: what drives each pair, beside the chart. Gold against the US
  // dollar and yields; bitcoin against who's hitting the market (taker flow).
  // Each check that agrees adds a little confidence, one against takes more
  // off, and a setup pushed under the floor waits. Kept with the trade.
  const checks: { dollar?: CheckVerdict; flow?: CheckVerdict } = {};
  const checkNotes: string[] = [];
  if (plan.verdict === "trade") {
    const dollarData = await dollarJob;
    const dollar = dollarData ? dollarRead(dollarData.eurusd, dollarData.yields) : null;
    if (dollar) {
      checks.dollar = goldVerdict(plan.direction, dollar.dollar);
      checkNotes.push(`US dollar check: ${dollar.note}`);
    }
    if (inst.asset === "crypto") {
      const entryMs = { "1m": 60_000, "5m": 300_000 }[fast ?? "5m"] ?? 300_000;
      const flowNow = takerFlow(entryCandles.filter((c) => c.t + entryMs <= Date.now()));
      if (flowNow) {
        checks.flow = flowVerdict(plan.direction, flowNow.buyShare);
        checkNotes.push(`Order flow check: ${flowNow.note}`);
      }
    }
    const verdicts = Object.values(checks);
    if (verdicts.length) {
      const pct = adjustConfidence(plan.confidencePct, verdicts);
      const against = checks.dollar === "against" || checks.flow === "against";
      const why =
        checks.dollar === "against"
          ? `The US dollar's against it (${plan.direction === "BUY" ? "strengthening" : "weakening"}), and gold usually moves the other way.`
          : "The order flow's against it: the other side is hitting the market harder.";
      plan = {
        ...plan,
        confidencePct: pct,
        confidence: pct >= 75 ? "High" : pct >= 62 ? "Medium" : "Low",
        ...(against ? { cautions: [why, ...plan.cautions] } : {}),
      };
      const floor = (tuning ?? DEFAULT_TUNING).minConfidence;
      if (against && pct < floor) {
        if (relaxed.has("trial_check")) relaxedBy ??= "trial_check";
        else plan = { ...plan, verdict: "wait", waitReason: `Trial check: ${why}` };
      }
    }
  }
  const price = Number.isFinite(live) && live > 0 ? live : lo.close;
  const dp = decimalsFor(inst, price);
  const fmt = (n: number) =>
    n.toLocaleString("en-GB", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
      useGrouping: false,
    });
  const dist = (a: number, b: number) =>
    inst.pip ? `${(Math.abs(a - b) / inst.pip).toFixed(0)} pips` : `${fmt(Math.abs(a - b))} points`;
  // Every level is the exact number on the card: what members see is what's
  // followed, so a target only counts once price really reaches it.
  const shown = (n: number) => Number(n.toFixed(dp));
  plan.entry = shown(plan.entry);
  plan.stop = shown(plan.stop);
  plan.targets = [shown(plan.targets[0]), shown(plan.targets[1]), shown(plan.targets[2])];

  // On the spot price too, so today's range and change match the levels.
  const lastDay = dailyOnSpot[dailyOnSpot.length - 1];
  const prevDay = dailyOnSpot[dailyOnSpot.length - 2];
  const change = prevDay ? ((price - prevDay.c) / prevDay.c) * 100 : NaN;
  const asOf = new Date(entryCandles[entryCandles.length - 1]?.t ?? Date.now())
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const chartSource = fast
    ? quick.source
    : style === "scalp"
      ? fifteen.source
      : hourly.source || daily.source;
  const spotNote = offset
    ? `chart moved ${offset > 0 ? "+" : "−"}${fmt(Math.abs(offset))} onto ${spotSource.get(inst.code) === "vantage" ? "Vantage's live price" : "the Swissquote spot price"}`
    : inst.sourceNote;
  const source = [chartSource, spotNote].filter(Boolean).join("; ");

  const lines = [
    `LIVE MARKET DATA — ${inst.label} (${style} view, entry timeframe ${entryLabel}; source: ${source}; last candle ${asOf} UTC)`,
    `Price now: ${fmt(price)}${Number.isFinite(change) ? ` (${change >= 0 ? "+" : ""}${change.toFixed(2)}% vs yesterday's close)` : ""}${lastDay ? `, today's range ${fmt(lastDay.l)} – ${fmt(lastDay.h)}` : ""}`,
    frameLine(hi, fmt),
    frameLine(mid, fmt),
    frameLine(lo, fmt),
    `Resistance: ${plan.resistance.map(fmt).join(", ") || "none nearby"}`,
    `Support: ${plan.support.map(fmt).join(", ") || "none nearby"}`,
    "",
    `SIGNAL ENGINE (computed from the data above — quote these exactly):`,
    plan.verdict === "wait"
      ? `Verdict: WAIT (no trade right now): ${plan.waitReason} Leaning ${plan.direction}, but don't take it yet.`
      : `Verdict: TRADE`,
    `Direction: ${plan.direction}`,
  ];
  const valid = validityWindow(style);
  const ukTime = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  // Big scheduled news, volume and (crypto) futures positioning.
  const news2 = newsRisk(calendar, inst, Date.now(), valid.until.getTime(), ukTime);
  // Light volume is already a caution from the engine; busy volume is a reason.
  const volNote = volume >= 1.5 ? volumeNote(volume) : null;
  const flowRead = flow ? cryptoFlowRead(flow, plan.direction) : { note: null };
  const cautions = [...plan.cautions, news2.caution, flowRead.caution].filter(
    (c): c is string => !!c,
  );
  const tested = calibrationLine(saved, plan.confidence);
  const newsLines = news2.events.map(
    (e) => `${ukTime(new Date(e.at))} UK: ${e.currency} ${e.title}`,
  );
  const extraReasons = [volNote, flowRead.note].filter((x): x is string => !!x);
  lines.push(
    `Confidence: ${plan.confidencePct}% (${plan.confidence})`,
    `Setup quality: ${plan.quality}`,
    ...cautions.map((c) => `CAUTION: ${c}`),
    `Entry: ${fmt(plan.entry)} — ${plan.entryNote}`,
    `Stop loss: ${fmt(plan.stop)} (${dist(plan.entry, plan.stop)})`,
    `Take profit: ${fmt(plan.targets[0])} (one target)`,
    `Risk:reward: ${plan.rr}`,
    `Valid until: ${ukTime(valid.until)} UK time (${style} signal, good for ${valid.hours} hours). After that the read is stale; cancel an unfilled entry and ask again.`,
    `Cancel early if: ${plan.invalidation}`,
  );
  lines.push(
    `Confluence score: ${plan.score} of ±${plan.maxScore}`,
    `Reasons: ${[...plan.reasons, ...extraReasons].join("; ")}`,
  );
  if (checkNotes.length) lines.push("", "PAIR CHECKS (live trial):", ...checkNotes);
  if (newsLines.length)
    lines.push("", "HIGH-IMPACT NEWS DURING THIS SIGNAL (economic calendar):", ...newsLines);
  if (record) lines.push("", `TRACK RECORD: ${record}`);
  if (tested) lines.push(`BACKTEST: ${tested}`);
  if (news)
    lines.push("", "MARKET HEADLINES (Yahoo Finance; for context and news risk only):", news);

  const value = `${HOW_TO_ANSWER}\n\n${lines.join("\n")}`;
  const expiresAt = valid.until.toISOString();
  // Telegram gets the engine's actual card, not model-authored levels or a refusal.
  // A brief card: the levels first, one per line, then only what changes
  // the decision (cautions, trend, when to bail).
  const arrow = (bias: string) => (bias === "bullish" ? "↑" : bias === "bearish" ? "↓" : "↔");
  const trends = plan.reasons
    .map((r) => /^(\S+) trend (\w+)$/.exec(r))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]} ${arrow(m[2])}`);
  const bail = /^a (\S+) close (above|below) the stop, or the (\S+) trend flipping (\w+)$/.exec(
    plan.invalidation,
  );
  const cancelIf = bail
    ? `${bail[1]} closes ${bail[2]} SL, or ${bail[3]} turns ${bail[4]}`
    : plan.invalidation;
  const rrs = plan.rr.split(" / ").map((r) => r.replace(/\.0$/, ""));
  // No clean setup: say so plainly instead of handing out levels to trade.
  // Nothing worth trading: short and rude, not an essay.
  const waitCard = [
    `⏸ No signal · ${inst.label} · ${entryLabel}`,
    // Market shut (gold at the weekend): say that, not "the chart's a mess".
    /\bclosed\b/i.test(plan.waitReason ?? "")
      ? MARKET_SHUT_LINE
      : NO_SIGNAL_LINES[Math.floor(Math.random() * NO_SIGNAL_LINES.length)],
  ].join("\n");
  // OG B0T talks its own trade through in the first person, plainly: what
  // it's doing and where, never telling anyone what to do. The levels
  // first, then only what changes the decision.
  // Confidence is indicator agreement (51–90%), not a win rate.
  // One take profit: by default the Quick Scalp (pulled in from TP1); the desk
  // may pick another inside the safe band around it (tpRange).
  // Learned exits (5-minute scalps): a runner. Every trade has the Boss's
  // profit lock (PROFIT_LOCK): 70% of the way to the take profit, the stop
  // moves to 30% of the way. It replaces the older learned breakeven.
  const exits = entryLabel === "5M" ? (tuning ?? DEFAULT_TUNING) : DEFAULT_TUNING;
  const { exitTargets } = await import("./signal-learning.server");
  const { profitLock } = await import("./trade-signal-outcome");
  const targetsFor = (tp: number) => {
    const t = exitTargets(plan.entry, tp, exits.runner);
    return [t[0], shown(t[1]), shown(t[2])] as [number, number, number];
  };
  const exitLines = (tp: number) => {
    const run = targetsFor(tp)[2];
    const lock = profitLock(plan.direction, plan.entry, tp);
    return [
      ...(run !== tp
        ? [`🏃 I'll bank a third at ${fmt(tp)} and let the rest run to ${fmt(run)}`]
        : []),
      ...(lock
        ? [
            `🔒 At ${fmt(shown(lock.trigger))} (70% of the way) my stop moves to ${fmt(shown(lock.stop))}, locking in profit`,
          ]
        : []),
    ];
  };
  // Some trades (the surest, going with the bigger timeframe) get an open
  // take profit and a trailing stop instead (TRAIL): only a far cap, the
  // stop to the entry once it's a full risk up, then a risk behind the best.
  const { TRAIL, trailsThis } = await import("./trade-signal-outcome");
  const trailRisk = Math.abs(plan.entry - plan.stop);
  const trails =
    plan.verdict === "trade" &&
    trailRisk > 0 &&
    trailsThis(plan.confidencePct, plan.direction, hi.bias);
  const trailCap = shown(plan.entry + (plan.direction === "BUY" ? 1 : -1) * trailRisk * TRAIL.CAP);
  const cardFor = (tp: number) =>
    [
      ...(trails
        ? [
            ...tradeLines(
              fmt,
              inst,
              plan.entry,
              plan.entryType,
              plan.direction,
              plan.stop,
              trailCap,
            ).slice(0, 2),
            `🎯 Open take profit · trailing my stop once it's ${fmt(shown(plan.entry + (plan.direction === "BUY" ? 1 : -1) * trailRisk))} (max ${fmt(trailCap)})`,
          ]
        : [
            ...tradeLines(fmt, inst, plan.entry, plan.entryType, plan.direction, plan.stop, tp),
            ...exitLines(tp),
          ]),
      "",
      `⏱ ${entryLabel} · 💪 ${plan.confidencePct}%`,
      ...(plan.setup ? [`🧩 ${plan.setup}`] : []),
      // Only what changes the decision: the top warning, the next big news.
      ...(cautions.length ? [`⚠️ ${cautions[0]}`] : []),
      ...(newsLines.length ? [`📅 ${newsLines[0]}`] : []),
    ].join("\n");
  const tradeCard = cardFor(plan.targets[0]);
  const wait = plan.verdict === "wait";
  const reply = wait ? waitCard : tradeCard;
  const plan2: SignalPlan = {
    market: inst.code,
    label: inst.label,
    feeds: {
      ...(inst.futures ? { futures: inst.futures } : {}),
      binance: inst.binance,
      kraken: inst.kraken,
      yahoo: inst.yahoo,
      ...(offset ? { offset } : {}),
      // Followed on the same price: the spot quote, or Vantage's own for bitcoin.
      ...(spotOk && (inst.spot || spotSource.get(inst.code) === "vantage")
        ? { spot: inst.spot ?? "vantage" }
        : {}),
      ...(plan.entryType === "stop" ? { entry: "stop" as const } : {}),
      ...(plan.setup ? { setup: plan.setup } : {}),
      // A learned-off filter that let this one through (its live record decides if it stays off).
      ...(relaxedBy && plan.verdict === "trade" ? { relaxed: relaxedBy } : {}),
      // What the live-trial pair checks said (the Boss's report groups by it).
      ...(Object.keys(checks).length ? { checks } : {}),
      // The learned time limits (5-minute scalps): the tracker applies them.
      ...timeLimitFeeds(entryLabel, tuning ?? DEFAULT_TUNING),
      // The profit lock (the tracker works out its levels from the entry and TP1).
      // The profit lock, or (trailing trades) the trailing stop.
      ...(trails ? { trail: { risk: trailRisk } } : { lock: true }),
    },
    style,
    timeframe: entryLabel,
    direction: plan.direction,
    entry: plan.entry,
    entryType: plan.entryType,
    stop: plan.stop,
    // One take profit: all three levels on it, so one hit closes the trade;
    // with a learned runner, a third there and the rest further on.
    targets: trails ? [trailCap, trailCap, trailCap] : targetsFor(plan.targets[0]),
    confidencePct: plan.confidencePct,
    quality: plan.quality,
    decimals: dp,
    pip: inst.pip ?? null,
    expiresAt,
  };
  // A "wait" isn't a trade, so there's nothing to follow.
  const summary: SignalSummary = {
    market: inst.code,
    label: inst.label,
    timeframe: entryLabel,
    verdict: plan.verdict,
    waitReason: plan.waitReason,
    direction: plan.direction,
    confidencePct: plan.confidencePct,
    confidence: plan.confidence,
    quality: plan.quality,
    entry: plan.entry,
    entryType: plan.entryType,
    stop: plan.stop,
    targets: [plan.targets[0]],
    rrs: rrs.slice(0, 1),
    price,
    changePct: Number.isFinite(change) ? change : null,
    offset,
    trends,
    cautions: [...cautions, ...newsLines.map((l) => `Big news: ${l}`)],
    cancelIf,
    validUntil: expiresAt,
    decimals: dp,
    pip: inst.pip ?? null,
    source,
    tested,
    builtAt: new Date().toISOString(),
  };
  // No clean setup (market open): the risky market-bias call instead.
  const shut = /\bclosed\b/i.test(plan.waitReason ?? "");
  const biasArgs: BiasArgs | undefined =
    shut || spotUnconfirmed || sitOut
      ? undefined
      : {
          inst,
          fast,
          quick: quick.data,
          entryCandles,
          offset,
          price,
          prevDay: prevDay ?? null,
          levels: [...plan.resistance, ...plan.support],
          lean: plan.direction,
          fmt,
          feeds: plan2.feeds,
          style,
          dp,
        };
  const biasCall = wait && biasArgs ? await buildBias(biasArgs).catch(() => null) : null;
  const tpRange = takeProfitRange(plan.entry, plan.targets[0], dp);
  const result = {
    block: value,
    expiresAt,
    reply,
    plan: wait ? undefined : plan2,
    summary,
    ...(wait
      ? {}
      : {
          tpRange,
          retarget: (picked: number) => {
            // The exact number on the card, as with every level.
            const tp = Number(picked.toFixed(dp));
            // A trailing trade has no fixed take profit to move.
            if (trails) return { reply: tradeCard, plan: plan2 };
            return {
              reply: cardFor(tp),
              plan: { ...plan2, targets: targetsFor(tp) },
            };
          },
        }),
    ...(biasCall ? { bias: biasCall.plan, biasReply: biasCall.reply } : {}),
    ...(biasArgs ? { biasArgs } : {}),
  };
  cache.set(key, { exp: Date.now() + (fast ? 10_000 : 60_000), at: Date.now(), ...result });
  const oldest = cache.keys().next().value;
  if (cache.size > 200 && oldest) cache.delete(oldest);
  return result;
}

/** The targets' names on cards and updates: TP1, TP2, TP3. */
export const TARGET_NAMES = ["Quick Scalp", "Little Brave", "Greedy Runner"] as const;

/** The levels in OG B0T's own words: where it's going in, where it's out, what it's after. */
function tradeLines(
  fmt: (n: number) => string,
  inst: { code: string; label: string },
  entry: number,
  entryType: "market" | "limit" | "stop",
  direction: "BUY" | "SELL",
  stop: number,
  tp: number,
  bias = false,
): string[] {
  // A market-bias call "isn't my signal", so it's what OG B0T would do.
  const e = fmt(entry);
  const side = direction === "BUY" ? "buy" : "sell";
  const where =
    entryType === "limit"
      ? `at ${e} on a pullback`
      : entryType === "stop"
        ? `if it breaks ${direction === "BUY" ? "above" : "below"} ${e}`
        : `now at ${e}`;
  // What CARD_LOT (0.5) makes or loses; left off when the contract size
  // isn't standard enough to say.
  const usd = (n: number) =>
    `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const loss = lotMoney(inst.code, entry, stop);
  const win = lotMoney(inst.code, entry, tp);
  return [
    `${direction === "BUY" ? "🟢" : "🔴"} ${bias ? `I'd ${side}` : `I'm gonna ${side}`} ${marketTag(inst)} ${where}`,
    `🛑 My stop loss ${bias ? "would" : "will"} be ${fmt(stop)}${loss != null ? ` · −${usd(loss)}` : ""}`,
    `🎯 ${bias ? "I'd" : "I'll"} take profit at ${fmt(tp)}${win != null ? ` · +${usd(win)}` : ""}`,
  ];
}

/**
 * The safe band a take profit can sit in: from 75% to 125% of the way to the
 * Quick Scalp (so between about 60% and 100% of the engine's TP1).
 */
export function takeProfitRange(entry: number, quick: number, dp: number) {
  const d = quick - entry;
  const at = (k: number) => Number((entry + d * k).toFixed(dp));
  return { lo: at(0.75), hi: at(1.25), quick };
}

/** "₿ BTC/USD", "🥇 XAU/USD", "💱 EUR/USD": short, with the market's emoji. */
function marketTag(inst: { code: string; label: string }): string {
  const emoji = inst.code === "XAUUSD" ? "🥇" : /^BTC/.test(inst.code) ? "₿" : "💱";
  return `${emoji} ${inst.label.replace(/\s*\(.*\)$/, "")}`;
}

/**
 * A member's signal request, decided by OG B0T's AI desk (signal-desk.server.ts).
 * The analysts read the same chart data and the chief picks BUY or SELL. If
 * the engine has a real signal that way, that's the card; otherwise it's the
 * market-bias call on the chief's side. All prices still come from code.
 * Any desk failure gives the engine's own card, exactly as before.
 */
export async function deskSignal(userText: string): Promise<TradeSignalResult> {
  return (await deskRead(userText)).signal;
}

/** deskSignal, plus the desk's own call (null when the desk didn't decide). */
export async function deskRead(
  userText: string,
  opts: { onlyWithSignal?: boolean } = {},
): Promise<{ signal: TradeSignalResult; desk: DeskDecision | null }> {
  const s = await buildTradeSignal(userText);
  const inst = detectTradeIntent(userText);
  if (!inst || !s.biasArgs || !s.block) return { signal: s, desk: null };
  // The scouts only post real signals, so with none there's nothing to ask
  // the AIs: saves their free daily allowances for when it counts.
  if (opts.onlyWithSignal && !s.plan) return { signal: s, desk: null };
  try {
    const { runDesk } = await import("./signal-desk.server");
    const chart = s.block.slice(Math.max(0, s.block.indexOf("LIVE MARKET DATA")));
    // What it's learned from past signals on this market, for the desk to weigh.
    const { learnedLesson } = await import("./signal-learning.server");
    const lesson = await learnedLesson(inst.code).catch(() => null);
    // The chief also picks the one take profit, inside a safe band around TP1.
    const band = s.plan && s.tpRange ? { direction: s.plan.direction, ...s.tpRange } : undefined;
    const desk = await runDesk(
      inst.label,
      lesson ? `WHAT I'VE LEARNED FROM PAST SIGNALS: ${lesson}\n\n${chart}` : chart,
      band,
    );
    if (!desk) return { signal: s, desk: null };
    // The desk only picks the side and the take profit; the card never mentions it.
    if (s.plan && s.plan.direction === desk.direction) {
      const picked = desk.tp != null && s.retarget ? s.retarget(desk.tp) : null;
      return { signal: picked ? { ...s, ...picked } : s, desk };
    }
    const bias =
      s.bias && s.biasReply && s.bias.direction === desk.direction
        ? { plan: s.bias, reply: s.biasReply }
        : await buildBias(s.biasArgs, desk.direction);
    if (!bias) return { signal: s, desk };
    return {
      signal: { ...s, plan: undefined, bias: bias.plan, biasReply: bias.reply },
      desk,
    };
  } catch (e) {
    console.warn("[signals] desk failed", e);
    return { signal: s, desk: null };
  }
}

/** The lowest confidence a 1-minute signal is traded at. */
export const ONE_MINUTE_MIN_CONFIDENCE = 80;

/**
 * The charts the proven extra setups and chart patterns are read on (the
 * scanner scans all four); the market's confidence floor (80% on the
 * 1-minute) still applies to them.
 */
export const SETUP_FRAMES: Interval[] = ["1m", "5m", "15m", "1h"];
const FRAME_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/** A market-bias call lasts this long (it's meant to trigger within minutes). */
const BIAS_VALID_MS = 60 * 60_000;

type BiasArgs = {
  inst: Instrument;
  fast: FastFrame | undefined;
  quick: Candle[];
  entryCandles: Candle[];
  offset: number;
  price: number;
  prevDay: Candle | null;
  levels: number[];
  lean: "BUY" | "SELL";
  fmt: (n: number) => string;
  feeds: SignalFeeds;
  style: Style;
  dp: number;
};

/** The market-bias card: the side the highs and lows lean, clearly not a signal. */
async function buildBias(
  o: BiasArgs,
  force?: "BUY" | "SELL",
): Promise<{ plan: SignalPlan; reply: string } | null> {
  const { marketBias } = await import("./trade-bias");
  // Read the 5-minute chart (already loaded for a 5M ask), else the entry chart.
  const five =
    o.fast === "5m"
      ? shiftCandles(o.quick, o.offset)
      : shiftCandles((await candles(o.inst, "5m").catch(() => ({ data: [] }))).data, o.offset);
  const recent = five.length >= 12 ? five : o.entryCandles;
  const read = marketBias({
    recent,
    price: o.price,
    prevDay: o.prevDay,
    levels: o.levels,
    lean: o.lean,
    force,
    tuning: await import("./signal-learning.server")
      .then((m) => m.learnedTuning(o.inst.code))
      .catch(() => undefined),
  });
  if (!read) return null;
  // The exact numbers on the card, as with every signal.
  const shown = (n: number) => Number(n.toFixed(o.dp));
  read.entry = shown(read.entry);
  read.stop = shown(read.stop);
  read.targets = [shown(read.targets[0]), shown(read.targets[1]), shown(read.targets[2])];
  const { fmt } = o;
  const until = new Date(Date.now() + BIAS_VALID_MS);
  const ukClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(until);
  const buy = read.direction === "BUY";
  const reply = [
    `⚠️ MARKET BIAS · not my signal · super risky`,
    ...tradeLines(
      fmt,
      o.inst,
      read.entry,
      read.entryType,
      read.direction,
      read.stop,
      read.targets[0],
      true,
    ),
  ].join("\n");
  const plan: SignalPlan = {
    market: o.inst.code,
    label: o.inst.label,
    feeds: {
      ...(o.feeds.futures ? { futures: o.feeds.futures } : {}),
      binance: o.feeds.binance,
      kraken: o.feeds.kraken,
      yahoo: o.feeds.yahoo,
      ...(o.offset ? { offset: o.offset } : {}),
      ...(o.feeds.spot ? { spot: o.feeds.spot } : {}),
      ...(read.entryType === "stop" ? { entry: "stop" as const } : {}),
      bias: true,
    },
    style: o.style,
    timeframe: "5M",
    direction: read.direction,
    entry: read.entry,
    entryType: read.entryType,
    stop: read.stop,
    // One take profit, as with every signal.
    targets: [read.targets[0], read.targets[0], read.targets[0]],
    confidencePct: 0,
    quality: "Choppy",
    decimals: o.dp,
    pip: o.inst.pip ?? null,
    expiresAt: until.toISOString(),
  };
  return { plan, reply };
}

/** How often the Telegram clean-up job runs (sports-guide-reminders cron). */
const SWEEP_MS = 5 * 60_000;

/**
 * When a Telegram signal reply should self-destruct: as the signal expires.
 * The clean-up job runs every 5 minutes, so the delete is scheduled one sweep
 * early to make sure the message is gone by the valid-until time.
 */
export function tradeReplyTtlMs(userText: string): number {
  const ms = validityWindow(detectStyle(userText)).hours * 3600_000;
  return Math.max(SWEEP_MS, ms - SWEEP_MS);
}

/** Telegram chat replies go out as plain text, so drop markdown emphasis. */
export function plainForTelegram(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
}
