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
  spotOffset,
  volumeNote,
  volumeRatio,
} from "./trade-signal-extras";
import { calibrationLine } from "./trade-signal-backtest";
import {
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
const candleCache = new Map<string, { exp: number; value: { data: Candle[]; source: string } }>();
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
  if (hit && hit.exp > Date.now()) return hit.value;
  const running = inflight.get(key);
  if (running) return running;

  const limit = interval === "1d" ? 365 : interval === "1h" ? 1000 : 500;
  const tries: [string, () => Promise<Candle[]>][] = [];
  const { binance, kraken, yahoo } = inst;
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
    if (value.data.length) candleCache.set(key, { exp: Date.now() + CANDLE_TTL[interval], value });
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
export async function spotPrice(inst: Instrument): Promise<number> {
  if (!inst.spot) return NaN;
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

let calendarCache: { exp: number; value: CalendarEvent[] } | null = null;

/** This week's economic calendar (free Forex Factory feed), cached for an hour. */
async function economicCalendar(): Promise<CalendarEvent[]> {
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
export type SignalFeeds = {
  binance?: string;
  kraken?: string;
  yahoo?: string;
  offset?: number;
  entry?: "stop";
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

/** The last line of every signal card. */
export const SIGNAL_DISCLAIMER =
  "⚠️ THIS AIN'T FINANCIAL ADVICE YOU BRAINLESS MUG. RISK 1–2% OR BLAME YOUR MUM.";

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
};
const cache = new Map<string, TradeSignalResult & { exp: number }>();

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
  TP1 / TP2 / TP3: …
  R:R: …
  ⏳ Valid until: … (UK time) — say plainly that after this time the signal is stale and they should ask you again, and that an unfilled pullback entry should be cancelled by then.
  Then 2–4 short lines on WHY (trend across timeframes, momentum, the key level), what would cancel it early, and any news risk from the headlines given.
- Give the Setup quality next to the confidence. For each CAUTION line, say it briefly in plain words (mixed timeframes, no clean setup, big news due, crowded futures) and that they should go smaller or wait.
- If a HIGH-IMPACT NEWS list is given, name those events and times. If a TRACK RECORD line is given, quote it exactly; never make one up.
- Explain that the confidence is how strongly the indicators agree, not a guaranteed win rate.
- Keep your usual voice for the commentary, but the numbers stay serious and exact.
- End with ONE short line: risk 1–2% per trade, move SL to entry after TP1, not financial advice. Don't lecture beyond that.
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
  const key = `${inst.code}:${style}:${entryIv}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now())
    return {
      block: hit.block,
      expiresAt: hit.expiresAt,
      reply: hit.reply,
      plan: hit.plan,
      summary: hit.summary,
    };

  const tracker = import("./trade-signal-tracker.server");
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
  const proxyNow =
    Number.isFinite(feedPrice) && feedPrice > 0
      ? feedPrice
      : (hourly.data[hourly.data.length - 1]?.c ?? NaN);
  const offset = spotOffset(spot, proxyNow);
  const live = offset ? spot : feedPrice;
  const { frames, entryCandles, middleCandles } = framesFor(
    {
      daily: shiftCandles(daily.data, offset),
      hourly: shiftCandles(hourly.data, offset),
      fifteen: shiftCandles(fifteen.data, offset),
      five: fast === "5m" ? shiftCandles(quick.data, offset) : [],
      minute: fast === "1m" ? shiftCandles(quick.data, offset) : [],
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
    cache.set(key, { exp: Date.now() + 30_000, ...result });
    return result;
  }

  // A proxy feed's volume (the PAX Gold token for gold) says nothing about
  // the real market, so it never counts for or against a signal there.
  const volume = inst.spot ? NaN : volumeRatio(entryCandles);
  const plan = buildPlan(hi, mid, lo, entryCandles, middleCandles, live, {
    volumeRatio: volume,
    session: sessionRead(inst),
  });
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

  const lastDay = daily.data[daily.data.length - 1];
  const prevDay = daily.data[daily.data.length - 2];
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
    ? `chart moved ${offset > 0 ? "+" : "−"}${fmt(Math.abs(offset))} onto the Swissquote spot price`
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
    `TP1: ${fmt(plan.targets[0])}  TP2: ${fmt(plan.targets[1])}  TP3: ${fmt(plan.targets[2])}`,
    `Risk:reward: ${plan.rr}`,
    `Valid until: ${ukTime(valid.until)} UK time (${style} signal, good for ${valid.hours} hours). After that the read is stale; cancel an unfilled entry and ask again.`,
    `Cancel early if: ${plan.invalidation}`,
  );
  lines.push(
    `Confluence score: ${plan.score} of ±${plan.maxScore}`,
    `Reasons: ${[...plan.reasons, ...extraReasons].join("; ")}`,
  );
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
  const londonDay = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short" }).format(d);
  const validShort =
    londonDay(valid.until) === londonDay(new Date())
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
        }).format(valid.until)
      : ukTime(valid.until);
  const rrs = plan.rr.split(" / ").map((r) => r.replace(/\.0$/, ""));
  const side = plan.direction === "BUY" ? "buy" : "sell";
  const entryHow =
    plan.entryType === "limit"
      ? "limit, wait for pullback"
      : plan.entryType === "stop"
        ? `${side} stop, only if price breaks ${plan.direction === "BUY" ? "above" : "below"}`
        : "market now";
  const trendLine = trends.length ? [`📊 Trend: ${trends.join("  ")}`] : [];
  // No clean setup: say so plainly instead of handing out levels to trade.
  // Nothing worth trading: short and rude, not an essay.
  const waitCard = [
    `⏸ No signal · ${inst.label} · ${entryLabel}`,
    // Market shut (gold at the weekend): say that, not "the chart's a mess".
    /\bclosed\b/i.test(plan.waitReason ?? "")
      ? MARKET_SHUT_LINE
      : NO_SIGNAL_LINES[Math.floor(Math.random() * NO_SIGNAL_LINES.length)],
  ].join("\n");
  // The levels first, one per line, then only what changes the decision.
  // No confidence %: members read it as a win rate.
  const targetNames = ["Quick Scalp", "Potentially", "Greedy Runner"];
  const tradeCard = [
    `${plan.direction === "BUY" ? "🟢" : "🔴"} ${plan.direction} · ${inst.label}`,
    `⏱ ${entryLabel} · ${plan.quality}`,
    "",
    // Stop loss first, so nobody enters without knowing where they're out.
    `🛑 Stop Loss: ${fmt(plan.stop)}`,
    `▶️ Entry: ${fmt(plan.entry)}  (${entryHow})`,
    ...plan.targets.map((t, i) => `🎯 ${targetNames[i]}: ${fmt(t)}`),
    "",
    ...cautions.map((c) => `⚠️ ${c}`),
    ...(newsLines.length ? [`📅 ${newsLines.join("\n📅 ")}`] : []),
    ...trendLine,
    `❌ Cancel if ${cancelIf}`,
    `⏳ Valid till ${validShort} UK`,
    "",
    SIGNAL_DISCLAIMER,
  ].join("\n");
  const wait = plan.verdict === "wait";
  const reply = wait ? waitCard : tradeCard;
  const plan2: SignalPlan = {
    market: inst.code,
    label: inst.label,
    feeds: {
      binance: inst.binance,
      kraken: inst.kraken,
      yahoo: inst.yahoo,
      ...(offset ? { offset } : {}),
      ...(plan.entryType === "stop" ? { entry: "stop" as const } : {}),
    },
    style,
    timeframe: entryLabel,
    direction: plan.direction,
    entry: plan.entry,
    entryType: plan.entryType,
    stop: plan.stop,
    targets: [plan.targets[0], plan.targets[1], plan.targets[2]],
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
    targets: plan.targets,
    rrs,
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
  const result = { block: value, expiresAt, reply, plan: wait ? undefined : plan2, summary };
  cache.set(key, { exp: Date.now() + (fast ? 10_000 : 60_000), ...result });
  const oldest = cache.keys().next().value;
  if (cache.size > 200 && oldest) cache.delete(oldest);
  return result;
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
