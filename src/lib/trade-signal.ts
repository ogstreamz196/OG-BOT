// Pure trade-analysis helpers for OG Bot: recognise the instrument a user asks
// about, compute indicators from real candles, and turn them into a trade
// plan with exact levels. No network here (see trade-signal-context.server.ts),
// so every number the bot quotes comes from code, not from the model.
import { CHOPPY_ADX, adx } from "./trade-signal-extras";

export type AssetClass = "forex" | "metal" | "crypto" | "index" | "commodity" | "stock";

export type Instrument = {
  /** What we call it back to the user, e.g. "XAU/USD (Gold)". */
  label: string;
  /** Short code, e.g. "XAUUSD". */
  code: string;
  asset: AssetClass;
  /** Yahoo Finance chart symbol. */
  yahoo?: string;
  /** Binance spot symbol (crypto, and PAXG as a spot-gold proxy). */
  binance?: string;
  /** Kraken pair (crypto fallback). */
  kraken?: string;
  /** Size of one pip, when traders talk in pips. */
  pip?: number;
  /** Extra caveat about the price source. */
  sourceNote?: string;
  /**
   * Swissquote spot quote (e.g. "XAU/USD") when the chart feed is a proxy for
   * the broker price (gold token, silver futures); charts are shifted onto it.
   */
  spot?: string;
};

export type Style = "scalp" | "intraday" | "swing";

/** One price bar; `v` is volume when the feed has it. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

const FX = [
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "AUD",
  "NZD",
  "CAD",
  "CHF",
  "ZAR",
  "MXN",
  "SEK",
  "NOK",
  "SGD",
  "HKD",
  "TRY",
  "PLN",
  "CNH",
];

const CRYPTO: Record<string, string> = {
  BTC: "Bitcoin",
  XBT: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  BNB: "BNB",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  DOT: "Polkadot",
  LTC: "Litecoin",
  TRX: "Tron",
  MATIC: "Polygon",
  SHIB: "Shiba Inu",
  PEPE: "Pepe",
  TON: "Toncoin",
  SUI: "Sui",
  ARB: "Arbitrum",
  OP: "Optimism",
  NEAR: "Near",
};
const AMBIGUOUS = new Set(["NEAR", "LINK", "DOT", "TON", "OP", "SUI", "ARB", "ADA", "SOL", "TRX"]);
const CRYPTO_NAMES: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  solana: "SOL",
  ripple: "XRP",
  dogecoin: "DOGE",
  doge: "DOGE",
  cardano: "ADA",
  litecoin: "LTC",
  chainlink: "LINK",
};

const FIXED: { re: RegExp; make: () => Instrument }[] = [
  {
    re: /\b(xau\s*\/?\s*usd|gold)\b/i,
    make: () => ({
      label: "XAU/USD (Gold)",
      code: "XAUUSD",
      asset: "metal",
      binance: "PAXGUSDT",
      kraken: "PAXGUSD",
      yahoo: "GC=F",
      pip: 0.1,
      spot: "XAU/USD",
      sourceNote:
        "priced from PAX Gold (tracks spot gold); your broker may differ by a dollar or two",
    }),
  },
  {
    re: /\b(xag\s*\/?\s*usd|silver)\b/i,
    make: () => ({
      label: "XAG/USD (Silver)",
      code: "XAGUSD",
      asset: "metal",
      yahoo: "SI=F",
      pip: 0.01,
      spot: "XAG/USD",
      sourceNote: "priced from silver futures; spot at your broker can differ slightly",
    }),
  },
  { re: /\b(us\s*30|dow(\s*jones)?|dji)\b/i, make: () => idx("US30 (Dow Jones)", "US30", "^DJI") },
  {
    re: /\b(nas\s*100|us\s*100|nasdaq(\s*100)?|ndx)\b/i,
    make: () => idx("NAS100 (Nasdaq 100)", "NAS100", "^NDX"),
  },
  {
    re: /\b(spx\s*500|us\s*500|s\s*&\s*p(\s*500)?|sp500|spx)\b/i,
    make: () => idx("US500 (S&P 500)", "US500", "^GSPC"),
  },
  { re: /\b(ger\s*40|de\s*40|dax)\b/i, make: () => idx("GER40 (DAX)", "GER40", "^GDAXI") },
  { re: /\b(uk\s*100|ftse(\s*100)?)\b/i, make: () => idx("UK100 (FTSE 100)", "UK100", "^FTSE") },
  {
    re: /\b(us\s*oil|wti|crude(\s*oil)?|usoil)\b/i,
    make: () => cmd("USOIL (WTI crude)", "USOIL", "CL=F"),
  },
  { re: /\b(uk\s*oil|brent)\b/i, make: () => cmd("UKOIL (Brent crude)", "UKOIL", "BZ=F") },
];

function idx(label: string, code: string, yahoo: string): Instrument {
  return {
    label,
    code,
    asset: "index",
    yahoo,
    sourceNote: "cash index price; CFD quotes at your broker can differ a little",
  };
}
function cmd(label: string, code: string, yahoo: string): Instrument {
  return {
    label,
    code,
    asset: "commodity",
    yahoo,
    pip: 0.01,
    sourceNote: "priced from front-month futures",
  };
}

function fxPair(base: string, quote: string): Instrument {
  return {
    label: `${base}/${quote}`,
    code: `${base}${quote}`,
    asset: "forex",
    yahoo: `${base}${quote}=X`,
    pip: quote === "JPY" ? 0.01 : 0.0001,
  };
}

function cryptoPair(sym: string): Instrument {
  const s = sym === "XBT" ? "BTC" : sym;
  return {
    label: `${s}/USD (${CRYPTO[sym] ?? s})`,
    code: `${s}USD`,
    asset: "crypto",
    binance: `${s}USDT`,
    kraken: `${s === "BTC" ? "XBT" : s}USD`,
    yahoo: `${s}-USD`,
  };
}

/** Finds the market a message is about, or null. */
export function parseInstrument(text: string | null | undefined): Instrument | null {
  if (!text) return null;
  for (const f of FIXED) if (f.re.test(text)) return f.make();

  // Forex: EURUSD, EUR/USD, eur usd, EUR-USD (lookahead so matches can overlap)
  const up = text.toUpperCase();
  for (const m of up.matchAll(/(?=\b([A-Z]{3})\s*[/\-\s]?\s*([A-Z]{3})\b)/g)) {
    const [base, quote] = [m[1], m[2]];
    if (base !== quote && FX.includes(base) && FX.includes(quote)) return fxPair(base, quote);
  }
  // Crypto by ticker (BTC, btcusd, BTC/USDT, $SOL). Tickers that are also
  // everyday words only count when written in capitals, with $ or a USD pair.
  for (const m of text.matchAll(/(\$)?\b([A-Za-z]{2,5})(\s*[/-]?\s*(?:usdt|usdc|usd))?\b/gi)) {
    const sym = m[2].toUpperCase();
    if (!CRYPTO[sym]) continue;
    if (AMBIGUOUS.has(sym) && !m[1] && !m[3] && m[2] !== sym) continue;
    return cryptoPair(sym);
  }
  const lower = text.toLowerCase();
  for (const [name, sym] of Object.entries(CRYPTO_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return cryptoPair(sym);
  }
  // Stocks only with an explicit $TICKER, so ordinary words never match.
  const stock = text.match(/\$([A-Za-z]{1,5})\b/);
  if (stock) {
    const t = stock[1].toUpperCase();
    return { label: `${t} (stock)`, code: t, asset: "stock", yahoo: t };
  }
  return null;
}

const TRADE_WORDS =
  /\b(signals?|setups?|entry|entries|trade|trades|trading|long|short|buy|sell|bullish|bearish|analy[sz]e|analysis|tp|sl|take profit|stop loss|scalp|scalping|swing|chart|levels?|support|resistance|breakout|direction|bias|forecast|prediction|going up|going down|pump|dump|position)\b/i;

/** True when the user is asking for a trade call / market read on a specific market. */
export function detectTradeIntent(text: string | null | undefined): Instrument | null {
  if (!text) return null;
  const inst = parseInstrument(text);
  if (!inst) return null;
  const bare = text.replace(/[^a-z0-9/]/gi, "").length <= 12; // "xauusd?" / "gold now"
  return TRADE_WORDS.test(text) || bare ? inst : null;
}

const ANY_MARKET_ASK = new RegExp(
  [
    String.raw`^\W*(?:a\s+)?(?:signals?|setups?|scalps?|trades?)\W*(?:pl[sz]e?|please)?\W*$`,
    String.raw`\b(?:give|send|drop|show|post|gimme|any|where'?s)\b[^.?!]{0,25}\b(?:signals?|setups?|scalps?|trades?|entry|entries)\b`,
    String.raw`\b(?:want|need)\s+(?:a\s+|some\s+)?(?:signals?|setups?|scalps?)\b`,
    String.raw`\b(?:good|best|decent|top|nice)\s+(?:trades?|signals?|setups?|scalps?|entry|entries)\b`,
    String.raw`\bwhat\s+(?:should|do|can|shall)\s+i\s+(?:buy|sell|trade)\b`,
  ].join("|"),
  "i",
);

/** A signal ask that names no market ("whats a good trade right now", "give me signal"). */
export function isAnyMarketAsk(text: string | null | undefined): boolean {
  return !!text && !parseInstrument(text) && ANY_MARKET_ASK.test(text);
}

/** Resolve a short follow-up from recent USER messages, never old assistant levels. */
export function resolveTradeRequest(
  text: string,
  recent: { role: string; content: string; created_at: string }[],
  now = Date.now(),
): string | null {
  if (detectTradeIntent(text)) return text;
  if (parseInstrument(text) || !TRADE_WORDS.test(text)) return null;
  // Only explicit signal follow-ups inherit a market; ordinary requests don't.
  if (!/\b(signals?|setups?|entry|entries|sl|tp|scalp|swing|bullish|bearish)\b/i.test(text))
    return null;
  for (const message of recent) {
    if (message.role !== "user") continue;
    const age = now - Date.parse(message.created_at);
    if (!Number.isFinite(age) || age < 0 || age > 30 * 60_000) continue;
    const market = detectTradeIntent(message.content);
    if (market) return `${market.code} ${text}`;
    // An unrelated user turn ends the market conversation.
    if (!/\b(signals?|setups?|entry|entries|sl|tp|scalp|swing)\b/i.test(message.content)) break;
  }
  return null;
}

/** A scalp timed on 1- or 5-minute candles ("gold 5m", "btc m1"), else undefined. */
export function fastFrame(text: string): FastFrame | undefined {
  if (/\b(?:1\s?m|m1)\b/i.test(text)) return "1m";
  if (/\b(?:5\s?m|m5)\b/i.test(text)) return "5m";
  return undefined;
}

export function detectStyle(text: string): Style {
  if (/\b(scalp|scalping|1\s?m|5\s?m|15\s?m|m1|m5|m15|quick)\b/i.test(text)) return "scalp";
  if (/\b(swing|daily|weekly|long[\s-]?term|position|hold)\b/i.test(text)) return "swing";
  return "intraday";
}

/* ── Indicators ─────────────────────────────────────────────────────────── */

export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev =
    values.slice(0, Math.min(period, values.length)).reduce((a, b) => a + b, 0) /
    Math.min(period, values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    prev = i === period - 1 ? prev : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Wilder's Average True Range. */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length <= period) return NaN;
  const tr = candles.slice(1).map((c, i) => {
    const pc = candles[i].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
  let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

export function macdHist(closes: number[]): { hist: number; prevHist: number } {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]).filter((v) => Number.isFinite(v));
  const sig = ema(line, 9);
  const n = line.length;
  return { hist: line[n - 1] - sig[n - 1], prevHist: line[n - 2] - sig[n - 2] };
}

/** Fractal swing highs/lows (a bar higher/lower than `side` bars either side). */
export function swings(candles: Candle[], side = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = side; i < candles.length - side; i++) {
    const w = candles.slice(i - side, i + side + 1);
    if (w.every((c) => c.h <= candles[i].h)) highs.push(candles[i].h);
    if (w.every((c) => c.l >= candles[i].l)) lows.push(candles[i].l);
  }
  return { highs, lows };
}

/** Groups candles into bigger ones (e.g. 1h → 4h), aligned to UTC hours. */
export function aggregate(candles: Candle[], hours: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.t / (hours * 3600_000));
    const last = out[out.length - 1];
    if (last && Math.floor(last.t / (hours * 3600_000)) === bucket) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
    } else out.push({ ...c });
  }
  return out;
}

export type FrameRead = {
  name: string;
  bias: "bullish" | "bearish" | "ranging";
  score: number; // -2..2
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atr: number;
  macdHist: number;
  macdRising: boolean;
  /** Trend strength (ADX 14); NaN when there's too little data. */
  adx: number;
};

export function readFrame(name: string, candles: Candle[]): FrameRead | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const last = (a: number[]) => a[a.length - 1];
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const e200 = closes.length >= 200 ? last(ema(closes, 200)) : NaN;
  const close = last(closes);
  const m = macdHist(closes);
  let score = 0;
  if (close > e50) score += 1;
  else if (close < e50) score -= 1;
  if (Number.isFinite(e200)) {
    if (e50 > e200 && close > e200) score += 1;
    else if (e50 < e200 && close < e200) score -= 1;
  } else if (e20 > e50) score += 1;
  else if (e20 < e50) score -= 1;
  return {
    name,
    bias: score >= 1 ? "bullish" : score <= -1 ? "bearish" : "ranging",
    score,
    close,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    rsi: rsi(closes),
    atr: atr(candles),
    macdHist: m.hist,
    macdRising: m.hist > m.prevHist,
    adx: adx(candles),
  };
}

/* ── Signal engine ─────────────────────────────────────────────────────── */

export type EntryType = "market" | "limit" | "stop";

export type TradePlan = {
  direction: "BUY" | "SELL";
  entry: number;
  /** market: enter now. limit: wait for a pullback. stop: wait for price to confirm the move. */
  entryType: EntryType;
  entryNote: string;
  stop: number;
  targets: number[];
  rr: string;
  confidence: "Low" | "Medium" | "High";
  /** 51–90: how strongly the indicators agree on this direction (not a win rate). */
  confidencePct: number;
  /** Set when the timeframes are mixed, so the call is a lean rather than a clean setup. */
  caution?: string;
  /** Clean: trend and timeframes agree. Mixed: timeframes disagree. Choppy: no real trend. */
  quality: "Clean" | "Mixed" | "Choppy";
  /** Plain-English reason for a Choppy rating. */
  qualityNote?: string;
  /** Every warning worth showing the member, most important first. */
  cautions: string[];
  /**
   * trade: a setup worth taking. wait: no clean setup right now (the reason
   * says why); the levels are still worked out but shouldn't be traded.
   */
  verdict: "trade" | "wait";
  waitReason?: string;
  score: number;
  maxScore: number;
  reasons: string[];
  invalidation: string;
  resistance: number[];
  support: number[];
};

/** What the market hours mean for a signal right now (see sessionRead). */
export type SessionRead = {
  /** Set when the real market is shut, so no signal should be traded. */
  closed?: string;
  /** Thin or awkward trading hours worth a warning. */
  caution?: string;
  /** Confidence points to take off for those hours. */
  penalty: number;
};

export type EngineOptions = {
  /**
   * The original rules (no momentum or volume penalty, no confirmation entry,
   * no room check). Only the backtest uses it, to compare old with new.
   */
  classic?: boolean;
  /** Entry-frame volume against its recent average (volumeRatio); NaN when unknown. */
  volumeRatio?: number;
  /** Market hours at the time of the signal. */
  session?: SessionRead;
};

/** A setup needs at least this much room (in R) to the next level in its way. */
export const MIN_ROOM_R = 1.5;
/**
 * A swing further than this many ATRs away is too far to hide the stop
 * behind; with nothing in between, a plain 2 ATR stop is used instead (the
 * classic rules squeezed the stop to 3 ATR, inside reach of the swing).
 */
const MAX_STOP_ATR = 3;
/** Members' stop loss is this much further from the entry than the engine's risk (+20%). */
export const STOP_ROOM = 1.2;
/** Below this volume ratio a move has little behind it. */
const LIGHT_VOLUME = 0.5;

const uniqSorted = (xs: number[], asc: boolean, tol: number) => {
  const s = [...xs].sort((a, b) => (asc ? a - b : b - a));
  const out: number[] = [];
  for (const x of s) if (!out.some((y) => Math.abs(y - x) < tol)) out.push(x);
  return out;
};

/**
 * Multi-timeframe confluence: the higher frame sets the bias, the entry
 * frame times it. Stops sit just beyond the nearest swing; targets are 1R
 * and then the real support and resistance levels. Setups that fight
 * short-term momentum wait for price to confirm, and setups with no room to
 * run or no trend are marked "wait".
 */
/**
 * The targets members get, from the engine's three (entry → TP1 → TP2 → TP3):
 * Quick Scalp 20% closer to the entry than TP1, Potentially 60% of the way
 * from TP1 to TP2, Greedy Runner 85% of the way from TP2 to TP3. Each new
 * target sits inside its own band, so they can't cross; the guard below keeps
 * them strictly in order (at least `minStep` apart, past the entry) even when
 * the engine's levels bunch up.
 */
export function scaleTargets(
  direction: "BUY" | "SELL",
  entry: number,
  [tp1, tp2, tp3]: [number, number, number],
  minStep: number,
): [number, number, number] {
  const s = direction === "BUY" ? 1 : -1;
  // Work in "distance in the trade's favour", so BUY and SELL are one sum.
  const d = (px: number) => (px - entry) * s;
  const d1 = d(tp1);
  const d2 = d(tp2);
  const d3 = d(tp3);
  let quick = d1 * 0.8;
  let potentially = d1 + 0.6 * (d2 - d1);
  let runner = d2 + 0.85 * (d3 - d2);
  const step = Math.max(minStep, 0);
  quick = Math.max(quick, step);
  potentially = Math.max(potentially, quick + step);
  runner = Math.max(runner, potentially + step);
  return [entry + quick * s, entry + potentially * s, entry + runner * s];
}

export function buildPlan(
  higher: FrameRead,
  middle: FrameRead,
  entry: FrameRead,
  entryCandles: Candle[],
  middleCandles: Candle[],
  /** The live price right now, when fresher than the last candle close. */
  priceNow?: number,
  opts: EngineOptions = {},
): TradePlan {
  const classic = !!opts.classic;
  const price =
    priceNow != null && Number.isFinite(priceNow) && priceNow > 0 ? priceNow : entry.close;
  const a = entry.atr;
  const tol = a * 0.3;
  const sw = swings(entryCandles.slice(-200));
  const swMid = swings(middleCandles.slice(-200));
  const resistance = uniqSorted(
    [...sw.highs, ...swMid.highs].filter((h) => h > price + a * 0.2),
    true,
    tol,
  ).slice(0, 3);
  const support = uniqSorted(
    [...sw.lows, ...swMid.lows].filter((l) => l < price - a * 0.2),
    false,
    tol,
  ).slice(0, 3);

  let score = higher.score * 1.5 + middle.score * 1.25 + entry.score * 0.75;
  if (entry.macdHist > 0 && entry.macdRising) score += 0.5;
  if (entry.macdHist < 0 && !entry.macdRising) score -= 0.5;
  const maxScore = 2 * 1.5 + 2 * 1.25 + 2 * 0.75 + 0.5;
  const reasons: string[] = [];
  reasons.push(
    `${higher.name} trend ${higher.bias}`,
    `${middle.name} trend ${middle.bias}`,
    `${entry.name} trend ${entry.bias}`,
  );
  reasons.push(`${entry.name} RSI ${entry.rsi.toFixed(0)}`);
  reasons.push(
    `${entry.name} MACD momentum ${entry.macdHist >= 0 ? "positive" : "negative"} and ${entry.macdRising ? "rising" : "falling"}`,
  );

  // Always name the most likely side: overall score, then the entry frame,
  // then momentum breaks a tie.
  const lean = Math.sign(score) || Math.sign(entry.score) || Math.sign(entry.macdHist) || 1;
  const long = lean > 0;
  const aligned =
    higher.score !== 0 && Math.sign(higher.score) === lean && Math.sign(middle.score) === lean;
  const strength = Math.min(1, Math.abs(score) / maxScore);
  const stretchedNow = long ? entry.rsi >= 74 : entry.rsi <= 26;
  // No real trend on the frames that time the trade: setups chop about.
  const choppy =
    Number.isFinite(middle.adx) &&
    Number.isFinite(entry.adx) &&
    middle.adx < CHOPPY_ADX &&
    entry.adx < CHOPPY_ADX;
  // Short-term momentum still pushing the other way (MACD on the wrong side
  // and moving further away), e.g. a SELL while the entry-frame MACD is
  // positive and rising.
  const momentumAgainst =
    !classic &&
    (long ? entry.macdHist < 0 && !entry.macdRising : entry.macdHist > 0 && entry.macdRising);
  const vol = opts.volumeRatio ?? NaN;
  const lightVolume = !classic && Number.isFinite(vol) && vol < LIGHT_VOLUME;
  const session = classic ? undefined : opts.session;

  let pct = 50 + strength * 40;
  if (!aligned) pct -= 8;
  if (stretchedNow) pct -= 5;
  if (choppy) pct -= 8;
  if (momentumAgainst) pct -= 12;
  if (lightVolume) pct -= 6;
  if (session) pct -= session.penalty;
  const confidencePct = Math.round(Math.min(90, Math.max(51, pct)));
  const confidence: TradePlan["confidence"] =
    confidencePct >= 75 ? "High" : confidencePct >= 62 ? "Medium" : "Low";
  const quality: TradePlan["quality"] = choppy ? "Choppy" : aligned ? "Clean" : "Mixed";
  const qualityNote = choppy
    ? `No clean setup: trend strength is weak (ADX ${middle.adx.toFixed(0)} on ${middle.name}, ${entry.adx.toFixed(0)} on ${entry.name}), so price is mostly ranging. Best to wait; if you take it, go small.`
    : undefined;
  const caution = aligned
    ? undefined
    : `Timeframes are mixed (${higher.name} ${higher.bias}, ${middle.name} ${middle.bias}, ${entry.name} ${entry.bias}), so this is the most likely side rather than a clean setup. Use smaller size.`;

  // Entry: don't chase a stretched move (pullback limit), and when
  // short-term momentum is against the trade, wait for price to confirm by
  // breaking the last two candles (a stop order) instead of entering now.
  const farFromMean = Math.abs(price - entry.ema20) > a * 1.2;
  let entryPx = price;
  let entryType: EntryType = "market";
  let entryNote = "Market price now";
  if (stretchedNow || farFromMean) {
    entryPx = entry.ema20;
    entryType = "limit";
    entryNote = `Limit on a pullback to the ${entry.name} 20 EMA (price is stretched right now)`;
  } else if (momentumAgainst) {
    const lastTwo = entryCandles.slice(-2);
    const trigger = long
      ? Math.max(price, ...lastTwo.map((c) => c.h)) + a * 0.1
      : Math.min(price, ...lastTwo.map((c) => c.l)) - a * 0.1;
    entryPx = trigger;
    entryType = "stop";
    entryNote = `Only if price ${long ? "breaks above" : "breaks below"} this level (confirms the move)`;
  }

  const structure = long
    ? support.find((s) => s < entryPx - a * 0.5)
    : resistance.find((r) => r > entryPx + a * 0.5);
  let risk = structure != null ? Math.abs(entryPx - structure) + a * 0.25 : a * 1.5;
  if (classic) risk = Math.min(Math.max(risk, a * 1), a * 3);
  else risk = risk > a * MAX_STOP_ATR ? a * 2 : Math.max(risk, a * 0.8);
  // Members' stop sits 20% further from the entry than the engine's risk, so
  // the trade has room to breathe; the targets keep the engine's R spacing.
  const stopDistance = classic ? risk : risk * STOP_ROOM;
  const stop = long ? entryPx - stopDistance : entryPx + stopDistance;
  const at = (r: number) => (long ? entryPx + risk * r : entryPx - risk * r);
  const t1 = at(1);
  let t1s = t1;
  // Opposing levels in the trade's way, nearest first.
  const ahead = long ? resistance.filter((r) => r > entryPx) : support.filter((s) => s < entryPx);
  const inR = (lvl: number) => Math.abs(lvl - entryPx) / risk;
  let t2: number;
  let t3: number;
  if (classic) {
    t2 = at(2);
    const beyond = long ? resistance.find((r) => r > t2) : support.find((s) => s < t2);
    t3 = beyond ?? at(3);
  } else {
    // TP2 at the first real level from 1.5R, TP3 at the next one beyond it.
    const lvl2 = ahead.find((l) => inR(l) >= 1.5);
    t2 = lvl2 ?? at(2);
    const lvl3 = ahead.find((l) => inR(l) >= inR(t2) + 0.5);
    t3 = lvl3 ?? at(Math.max(3, inR(t2) + 1));
  }
  // Targets members are shown and followed on: pulled in from the engine's
  // levels so they're hit more often (classic keeps the old ones to compare).
  if (!classic)
    [t1s, t2, t3] = scaleTargets(long ? "BUY" : "SELL", entryPx, [t1, t2, t3], a * 0.05);
  // Reward against the stop members actually use.
  const rr1 = Math.abs(t1s - entryPx) / stopDistance;
  const rr3 = Math.abs(t3 - entryPx) / stopDistance;
  const rr2 = Math.abs(t2 - entryPx) / stopDistance;
  const room = ahead.length ? inR(ahead[0]) : Infinity;

  const cautions: string[] = [];
  if (session?.closed) cautions.push(session.closed);
  if (qualityNote) cautions.push(qualityNote);
  if (caution) cautions.push(caution);
  if (momentumAgainst)
    cautions.push(
      `${entry.name} momentum is still pushing ${long ? "down" : "up"}, so only enter if price confirms the move.`,
    );
  if (lightVolume)
    cautions.push(`Volume is light (${vol.toFixed(1)}× average), so the move may not hold.`);
  if (session?.caution) cautions.push(session.caution);

  // When to sit it out rather than trade.
  let waitReason: string | undefined;
  if (!classic) {
    if (session?.closed) waitReason = session.closed;
    else if (choppy) waitReason = "No real trend right now, price is ranging.";
    else if (!aligned && momentumAgainst)
      waitReason = "The timeframes disagree and short-term momentum is against the trade.";
    else if (room < MIN_ROOM_R)
      waitReason = `Not enough room: the next ${long ? "resistance" : "support"} is only ${room.toFixed(1)}R away.`;
  }

  const fmtR = (r: number) =>
    Number.isInteger(Math.round(r * 10) / 10) ? r.toFixed(0) : r.toFixed(1);
  return {
    direction: long ? "BUY" : "SELL",
    entry: entryPx,
    entryType,
    entryNote,
    stop,
    targets: [t1s, t2, t3],
    rr: `1:${fmtR(rr1)} / 1:${fmtR(rr2)} / 1:${fmtR(rr3)}`,
    confidence,
    confidencePct,
    caution,
    quality,
    qualityNote,
    cautions,
    verdict: waitReason ? "wait" : "trade",
    waitReason,
    score: Math.round(score * 10) / 10,
    maxScore,
    reasons,
    invalidation: long
      ? `a ${middle.name} close below the stop, or the ${higher.name} trend flipping bearish`
      : `a ${middle.name} close above the stop, or the ${higher.name} trend flipping bullish`,
    resistance,
    support,
  };
}

/* ── Market hours ──────────────────────────────────────────────────────── */

const ukHour = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );

/**
 * Market hours for a signal made now. Gold, silver, forex and oil shut from
 * Friday 10pm to Sunday 11pm UK time (the gold feed is a token that trades
 * all weekend, but brokers don't), and go thin around the daily 10pm UK
 * rollover and in the quiet Asian morning. Crypto just gets a weekend note.
 */
export function sessionRead(inst: Instrument, now = Date.now()): SessionRead {
  const d = new Date(now);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(d);
  const hour = ukHour(d);
  if (inst.asset === "crypto") {
    return day === "Sat" || day === "Sun"
      ? { caution: "Weekend: thinner volume, so moves fake out more often.", penalty: 3 }
      : { penalty: 0 };
  }
  if (inst.asset === "stock" || inst.asset === "index") return { penalty: 0 };
  const shut = day === "Sat" || (day === "Fri" && hour >= 22) || (day === "Sun" && hour < 23);
  if (shut)
    return {
      closed: `The ${inst.label} market is closed for the weekend (opens Sunday 11pm UK). Wait for the open.`,
      penalty: 0,
    };
  if (hour === 22 || (hour === 23 && day !== "Sun"))
    return {
      caution: "Daily rollover hour: spreads widen and price can spike. Better to wait an hour.",
      penalty: 8,
    };
  if (hour >= 0 && hour < 7)
    return { caution: "Quiet Asian session: moves are smaller and less reliable.", penalty: 4 };
  return { penalty: 0 };
}

/* ── Whole analysis from candles ───────────────────────────────────────── */

export type CandleSets = {
  daily: Candle[];
  hourly: Candle[];
  fifteen: Candle[];
  five: Candle[];
  minute: Candle[];
};

/** The short entry timeframes (scalps timed on 1- or 5-minute candles). */
export type FastFrame = "1m" | "5m";

/**
 * The three timeframes for a style (higher, middle, entry) plus the candles
 * the plan works from. Shared by live signals and the backtest.
 */
export function framesFor(
  sets: CandleSets,
  style: Style,
  fast?: FastFrame,
): {
  frames: [FrameRead | null, FrameRead | null, FrameRead | null];
  entryCandles: Candle[];
  middleCandles: Candle[];
} {
  const { daily, hourly, fifteen, five, minute } = sets;
  const h4 = aggregate(hourly, 4);
  if (style === "swing") {
    const weekly = readFrame("Weekly", aggregate(daily, 24 * 7));
    // Weekly needs a year of dailies; fall back to Daily/4H/1H if it's short.
    if (weekly)
      return {
        frames: [weekly, readFrame("Daily", daily), readFrame("4H", h4)],
        entryCandles: h4,
        middleCandles: daily,
      };
  } else if (fast) {
    // 1H trend, 15M structure, entry timed on 1- or 5-minute candles.
    const entry = fast === "1m" ? minute : five;
    return {
      frames: [
        readFrame("1H", hourly),
        readFrame("15M", fifteen),
        readFrame(fast.toUpperCase(), entry),
      ],
      entryCandles: entry,
      middleCandles: fifteen,
    };
  } else if (style === "scalp") {
    return {
      frames: [readFrame("4H", h4), readFrame("1H", hourly), readFrame("15M", fifteen)],
      entryCandles: fifteen,
      middleCandles: hourly,
    };
  }
  return {
    frames: [readFrame("Daily", daily), readFrame("4H", h4), readFrame("1H", hourly)],
    entryCandles: hourly,
    middleCandles: h4,
  };
}

/**
 * How long a signal stays usable before the market has likely moved on.
 * Kept deliberately short (1h scalp, 4h intraday, 24h swing) so nobody
 * trades a stale read. After this the user should ask again for a fresh read.
 */
export function validityWindow(style: Style, now = Date.now()): { hours: number; until: Date } {
  const hours = style === "scalp" ? 1 : style === "swing" ? 24 : 4;
  return { hours, until: new Date(now + hours * 3600_000) };
}

/** Sensible decimals for quoting an instrument's price. */
export function decimalsFor(inst: Instrument, price: number): number {
  if (inst.asset === "forex") return inst.pip === 0.01 ? 3 : 5;
  if (inst.asset === "metal") return inst.code === "XAGUSD" ? 3 : 2;
  if (inst.asset === "index") return 1;
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 8;
}

/* ── Instant "hold on" message ─────────────────────────────────────────── */

export type HoldingTone = "foul" | "cheeky" | "safe";

/** Invisible tag on the holding line so chat history can leave it out. */
export const HOLDING_TAG = "⁣";

const HOLDING_LINES: Record<HoldingTone, string[]> = {
  foul: [
    "⏳ Hold your horses, you impatient sod. Pulling live {m} charts and grilling every timeframe. Honest signal lands in my next message, no bullshit.",
    "⏳ Chill, for fuck's sake. I'm ripping through {m} price action right now. Next message is the real signal, straight up.",
    "⏳ Sit tight, bellend. Scanning {m} across every timeframe so I don't feed you shite. Signal's coming next.",
    "⏳ Easy, you greedy bastard. Checking live {m} levels and the news. The honest call drops in my next message.",
  ],
  cheeky: [
    "⏳ Easy tiger. Pulling live {m} charts and checking every timeframe for the most honest read I can give. Signal lands in my next message.",
    "⏳ Kettle on, feet up. I'm scanning {m} right now. Next message is your signal, no fluff.",
    "⏳ Hold tight, chief. Crunching live {m} price action. The honest call is coming in my next message.",
    "⏳ Two secs, I'm not a magician. Reading the {m} charts properly. Signal follows in my next message.",
  ],
  safe: [
    "⏳ On it. I'm pulling live {m} prices and checking each timeframe so the signal is honest. It'll be in my next message.",
    "⏳ One moment while I scan live {m} data and the latest news. Your signal follows in my next message.",
    "⏳ Checking the {m} charts across timeframes now. The full signal will be my next message.",
  ],
};

/**
 * The instant line sent before a trade analysis, so the user knows the next
 * message is the signal. Picked at random from the pool for OG Bot's mood.
 */
export function holdingMessage(
  inst: Instrument,
  tone: HoldingTone,
  rand: () => number = Math.random,
): string {
  const pool = HOLDING_LINES[tone];
  const line = pool[Math.floor(rand() * pool.length) % pool.length];
  return line.replace("{m}", inst.label) + HOLDING_TAG;
}

export function isHoldingMessage(content: string | null | undefined): boolean {
  return !!content && content.endsWith(HOLDING_TAG);
}

/* ── Signal expiry tag (app chat) ─────────────────────────────────────── */

const EXPIRY_RE = /\n?\[\[SIGNAL_EXPIRES:([0-9T:.\-Z]+)\]\]/;

/** Adds a hidden expiry tag to a signal reply so the app can expire it. */
export function tagSignalExpiry(content: string, expiresAt: string): string {
  return `${content}\n[[SIGNAL_EXPIRES:${expiresAt}]]`;
}

/** When a tagged signal reply stops being valid, or null for other messages. */
export function signalExpiry(content: string | null | undefined): Date | null {
  const m = content?.match(EXPIRY_RE);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function stripSignalTag(content: string): string {
  return content.replace(EXPIRY_RE, "");
}

export const EXPIRED_SIGNAL_NOTE =
  "(An earlier trade signal was here. It has expired, so its levels are stale and must not be reused.)";

/**
 * Chat history for the AI: holding lines dropped, expiry tags removed, and
 * expired signals replaced with a note so stale levels are never repeated.
 */
export function cleanTradeHistory<T extends { role: string; content: string }>(
  messages: T[],
  now = Date.now(),
): T[] {
  return messages
    .filter((m) => !isHoldingMessage(m.content))
    .map((m) => {
      const exp = signalExpiry(m.content);
      if (!exp) return m;
      return {
        ...m,
        content: exp.getTime() <= now ? EXPIRED_SIGNAL_NOTE : stripSignalTag(m.content),
      };
    });
}

/* ── Fresh "hold on" lines from fragments ──────────────────────────────── */

const HOLD_PARTS: Record<HoldingTone, [string[], string[], string[]]> = {
  foul: [
    [
      "Hold up, you impatient sod.",
      "Oi, chill.",
      "Easy, you greedy git.",
      "Sit tight, bellend.",
      "Patience, you degen.",
      "Calm your tits.",
      "Bloody hell, one sec.",
      "Hang about, you chancer.",
    ],
    [
      "Pulling live {m} charts",
      "Grilling the {m} chart",
      "Scanning {m} on every timeframe",
      "Checking {m} levels and the news",
      "Crunching the {m} numbers",
      "Reading {m} candle by candle",
      "Digging through {m} price action",
    ],
    [
      "and the no-bullshit signal is my next message.",
      "so you get an honest call next.",
      "and the real signal lands next.",
      "before I give you the straight call.",
      "and the honest read follows.",
      "and your signal drops in a sec.",
    ],
  ],
  cheeky: [
    [
      "Easy tiger.",
      "Hold tight, chief.",
      "Two secs.",
      "Patience, legend.",
      "Steady on.",
      "Kettle on.",
      "Give us a mo.",
      "Slow your roll.",
    ],
    [
      "Pulling live {m} charts",
      "Checking {m} on every timeframe",
      "Scanning {m} levels and the news",
      "Crunching the {m} numbers",
      "Reading the {m} chart properly",
      "Grilling the {m} price action",
    ],
    [
      "and your signal lands in my next message.",
      "so the call you get next is honest.",
      "and the real read follows.",
      "and the signal's up next.",
      "before I send the honest call.",
    ],
  ],
  safe: [
    [
      "One moment.",
      "On it.",
      "Thanks for waiting.",
      "Just a moment.",
      "Bear with me.",
      "Right away.",
    ],
    [
      "I'm pulling live {m} prices",
      "I'm checking {m} across timeframes",
      "I'm analysing {m} trend and momentum",
      "I'm reviewing {m} support and resistance",
      "I'm scanning {m} data and headlines",
    ],
    [
      "and your signal follows in my next message.",
      "so the signal is honest. It's my next message.",
      "and I'll send the signal next.",
      "and the full signal is on its way.",
    ],
  ],
};

/** Brand-new "hold on" lines built from fragments, with {m} for the market. */
export function freshHoldingLines(
  tone: HoldingTone,
  n: number,
  rand: () => number = Math.random,
): string[] {
  const [a, b, c] = HOLD_PARTS[tone];
  const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length) % xs.length];
  const out = new Set<string>();
  for (let i = 0; i < n * 6 && out.size < n; i++) out.add(`⏳ ${pick(a)} ${pick(b)} ${pick(c)}`);
  return [...out];
}

/** Fills the {m} placeholder in a stored line and tags it as a holding line. */
export function renderHoldingLine(phrase: string, inst: Instrument): string {
  return phrase.split("{m}").join(inst.label) + HOLDING_TAG;
}
