// Pure trade-analysis helpers for OG Bot: recognise the instrument a user asks
// about, compute indicators from real candles, and turn them into a trade
// plan with exact levels. No network here (see trade-signal-context.server.ts),
// so every number the bot quotes comes from code, not from the model.

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
};

export type Style = "scalp" | "intraday" | "swing";

export type Candle = { t: number; o: number; h: number; l: number; c: number };

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
  };
}

/* ── Signal engine ─────────────────────────────────────────────────────── */

export type TradePlan = {
  direction: "BUY" | "SELL";
  entry: number;
  entryNote: string;
  stop: number;
  targets: number[];
  rr: string;
  confidence: "Low" | "Medium" | "High";
  /** 51–90: how strongly the indicators agree on this direction (not a win rate). */
  confidencePct: number;
  /** Set when the timeframes are mixed, so the call is a lean rather than a clean setup. */
  caution?: string;
  score: number;
  maxScore: number;
  reasons: string[];
  invalidation: string;
  resistance: number[];
  support: number[];
};

const uniqSorted = (xs: number[], asc: boolean, tol: number) => {
  const s = [...xs].sort((a, b) => (asc ? a - b : b - a));
  const out: number[] = [];
  for (const x of s) if (!out.some((y) => Math.abs(y - x) < tol)) out.push(x);
  return out;
};

/**
 * Multi-timeframe confluence: higher frame sets the bias, the entry frame
 * times it. Stops sit beyond the nearest swing (bounded by ATR), targets are
 * 1R, 2R and the next structure level.
 */
export function buildPlan(
  higher: FrameRead,
  middle: FrameRead,
  entry: FrameRead,
  entryCandles: Candle[],
  middleCandles: Candle[],
): TradePlan {
  const price = entry.close;
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
  let pct = 50 + strength * 40;
  if (!aligned) pct -= 8;
  if (stretchedNow) pct -= 5;
  const confidencePct = Math.round(Math.min(90, Math.max(51, pct)));
  const confidence: TradePlan["confidence"] =
    confidencePct >= 75 ? "High" : confidencePct >= 62 ? "Medium" : "Low";
  const caution = aligned
    ? undefined
    : `Timeframes are mixed (${higher.name} ${higher.bias}, ${middle.name} ${middle.bias}, ${entry.name} ${entry.bias}), so this is the most likely side rather than a clean setup. Use smaller size.`;

  // Don't chase: stretched momentum means wait for a pullback.
  const farFromMean = Math.abs(price - entry.ema20) > a * 1.2;
  let entryPx = price;
  let entryNote = "Market price now";
  if (stretchedNow || farFromMean) {
    entryPx = entry.ema20;
    entryNote = `Limit on a pullback to the ${entry.name} 20 EMA (price is stretched right now)`;
  }

  const structure = long
    ? support.find((s) => s < entryPx - a * 0.5)
    : resistance.find((r) => r > entryPx + a * 0.5);
  let risk = structure != null ? Math.abs(entryPx - structure) + a * 0.25 : a * 1.5;
  risk = Math.min(Math.max(risk, a * 1), a * 3);
  const stop = long ? entryPx - risk : entryPx + risk;
  const t1 = long ? entryPx + risk : entryPx - risk;
  const t2 = long ? entryPx + risk * 2 : entryPx - risk * 2;
  const beyond = long ? resistance.find((r) => r > t2) : support.find((s) => s < t2);
  const t3 = beyond ?? (long ? entryPx + risk * 3 : entryPx - risk * 3);
  const rr3 = Math.abs(t3 - entryPx) / risk;

  return {
    direction: long ? "BUY" : "SELL",
    entry: entryPx,
    entryNote,
    stop,
    targets: [t1, t2, t3],
    rr: `1:1 / 1:2 / 1:${rr3.toFixed(1)}`,
    confidence,
    confidencePct,
    caution,
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
