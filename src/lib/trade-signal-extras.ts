// Extra reads for trade signals, kept pure so they can be tested on sample
// data: trend strength (ADX), volume, the economic calendar and crypto
// futures positioning. The server side (trade-signal-context.server.ts)
// fetches the raw data; everything here only interprets it.
import type { Candle, Instrument } from "./trade-signal";

/* ── Trend strength ────────────────────────────────────────────────────── */

/**
 * Wilder's ADX: how strong the trend is, whatever its direction. Under ~20
 * the market is mostly ranging (trend-following setups chop about); over ~25
 * there's a real trend. NaN when there aren't enough candles.
 */
export function adx(candles: Candle[], period = 14): number {
  if (candles.length < period * 2 + 1) return NaN;
  let trS = 0;
  let pS = 0;
  let mS = 0;
  const dx: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.h - p.h;
    const down = p.l - c.l;
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    if (i <= period) {
      trS += tr;
      pS += pdm;
      mS += mdm;
      if (i < period) continue;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    if (trS <= 0) {
      dx.push(0);
      continue;
    }
    const pdi = (100 * pS) / trS;
    const mdi = (100 * mS) / trS;
    const sum = pdi + mdi;
    dx.push(sum > 0 ? (100 * Math.abs(pdi - mdi)) / sum : 0);
  }
  if (dx.length < period) return NaN;
  let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]) / period;
  return value;
}

/** Below this on both the entry and middle frames, call the market choppy. */
export const CHOPPY_ADX = 20;

/* ── Volume ────────────────────────────────────────────────────────────── */

/**
 * The latest few candles' volume against the average before them, e.g. 1.8
 * means 80% busier than usual. NaN when the feed has no volume.
 */
export function volumeRatio(candles: Candle[], recent = 3, lookback = 20): number {
  const vols = candles.map((c) => c.v ?? NaN);
  if (vols.length < recent + lookback) return NaN;
  const now = vols.slice(-recent);
  const before = vols.slice(-(recent + lookback), -recent);
  if (![...now, ...before].every((v) => Number.isFinite(v))) return NaN;
  const avgBefore = before.reduce((a, b) => a + b, 0) / before.length;
  if (avgBefore <= 0) return NaN;
  return now.reduce((a, b) => a + b, 0) / now.length / avgBefore;
}

export function volumeNote(ratio: number): string | null {
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 1.5)
    return `volume is ${ratio.toFixed(1)}× its recent average (the move has real participation)`;
  if (ratio <= 0.6)
    return `volume is light (${ratio.toFixed(1)}× average), so the move may not hold`;
  return null;
}

/* ── Economic calendar ─────────────────────────────────────────────────── */

export type CalendarEvent = { title: string; currency: string; at: number; impact: string };

/** Parses the free weekly calendar feed (Forex Factory JSON format). */
export function parseCalendar(json: unknown): CalendarEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CalendarEvent[] = [];
  for (const row of json as Record<string, unknown>[]) {
    const at = Date.parse(String(row?.date ?? ""));
    const title = String(row?.title ?? "").trim();
    const currency = String(row?.country ?? "").toUpperCase();
    const impact = String(row?.impact ?? "");
    if (!Number.isFinite(at) || !title || !currency) continue;
    out.push({ title, currency, at, impact });
  }
  return out;
}

const INDEX_CCY: Record<string, string> = {
  US30: "USD",
  NAS100: "USD",
  US500: "USD",
  GER40: "EUR",
  UK100: "GBP",
};

/** Currencies whose big news moves this market. */
export function newsCurrencies(inst: Instrument): string[] {
  if (inst.asset === "forex") return [inst.code.slice(0, 3), inst.code.slice(3, 6)];
  if (inst.asset === "index") return [INDEX_CCY[inst.code] ?? "USD"];
  // Gold, silver, oil, crypto and US stocks all react most to US data.
  return ["USD"];
}

export type NewsRisk = {
  /** High-impact events from 15 minutes ago until the signal expires. */
  events: CalendarEvent[];
  /** Set when one lands within 30 minutes either side of now: wait it out. */
  caution?: string;
};

/** Big scheduled news that could whip price around during the signal. */
export function newsRisk(
  events: CalendarEvent[],
  inst: Instrument,
  now: number,
  until: number,
  ukTime: (d: Date) => string,
): NewsRisk {
  const ccys = new Set(newsCurrencies(inst));
  const relevant = events
    .filter((e) => e.impact === "High" && ccys.has(e.currency))
    .filter((e) => e.at >= now - 15 * 60_000 && e.at <= until)
    .sort((a, b) => a.at - b.at);
  const close = relevant.find((e) => Math.abs(e.at - now) <= 30 * 60_000);
  return {
    events: relevant,
    caution: close
      ? `High-impact news ${close.at >= now ? "is due" : "has just landed"}: ${close.currency} ${close.title} at ${ukTime(new Date(close.at))} UK time. Price can jump straight through stops around it, so wait until it's out and the dust settles before entering.`
      : undefined,
  };
}

/* ── Crypto futures positioning ────────────────────────────────────────── */

export type CryptoFlow = {
  /** Last funding rate as a fraction (0.0001 = 0.01% per 8h). */
  funding: number;
  /** Open interest change over the last 24h, as a fraction. */
  oiChange24h: number;
};

export function parseFunding(json: unknown): number {
  const r = Number((json as { lastFundingRate?: unknown } | null)?.lastFundingRate);
  return Number.isFinite(r) ? r : NaN;
}

/** Open interest change from Binance's hourly history (oldest first). */
export function parseOpenInterestChange(json: unknown): number {
  if (!Array.isArray(json) || json.length < 2) return NaN;
  const first = Number((json[0] as { sumOpenInterest?: unknown }).sumOpenInterest);
  const last = Number((json[json.length - 1] as { sumOpenInterest?: unknown }).sumOpenInterest);
  return first > 0 && Number.isFinite(last) ? last / first - 1 : NaN;
}

/** Plain-English positioning read, plus a caution when the crowd is leaning hard the same way. */
export function cryptoFlowRead(
  flow: CryptoFlow,
  direction: "BUY" | "SELL",
): { note: string | null; caution?: string } {
  const parts: string[] = [];
  const f = flow.funding;
  if (Number.isFinite(f)) {
    const pct = `${f >= 0 ? "+" : ""}${(f * 100).toFixed(3)}%`;
    parts.push(
      `funding ${pct} (${f > 0 ? "longs paying shorts" : f < 0 ? "shorts paying longs" : "flat"})`,
    );
  }
  const oi = flow.oiChange24h;
  if (Number.isFinite(oi)) {
    parts.push(`open interest ${oi >= 0 ? "+" : ""}${(oi * 100).toFixed(1)}% in 24h`);
  }
  // Very high funding = the crowd is already long (squeeze risk on longs), and vice versa.
  const crowdedLong = f >= 0.0005;
  const crowdedShort = f <= -0.0005;
  const caution =
    direction === "BUY" && crowdedLong
      ? "Futures are crowded long (high funding), so a quick flush lower is a real risk. Keep size small."
      : direction === "SELL" && crowdedShort
        ? "Futures are crowded short (negative funding), so a short squeeze higher is a real risk. Keep size small."
        : undefined;
  return { note: parts.length ? parts.join(", ") : null, caution };
}

/* ── Live price ────────────────────────────────────────────────────────── */

export function parseBinanceTicker(json: unknown): number {
  const p = Number((json as { price?: unknown } | null)?.price);
  return p > 0 ? p : NaN;
}

export function parseKrakenTicker(json: unknown): number {
  const result = (json as { result?: Record<string, { c?: unknown[] }> } | null)?.result;
  const first = result ? Object.values(result)[0] : undefined;
  const p = Number(first?.c?.[0]);
  return p > 0 ? p : NaN;
}

export function parseYahooPrice(json: unknown): number {
  const meta = (
    json as { chart?: { result?: { meta?: { regularMarketPrice?: unknown } }[] } } | null
  )?.chart?.result?.[0]?.meta;
  const p = Number(meta?.regularMarketPrice);
  return p > 0 ? p : NaN;
}

/**
 * Spot price from Swissquote's free public quote feed: the middle of bid and
 * ask, taken as the median across its pricing platforms. NaN if unusable.
 */
export function parseSwissquoteMid(json: unknown): number {
  if (!Array.isArray(json)) return NaN;
  const mids: number[] = [];
  for (const row of json as { spreadProfilePrices?: { bid?: unknown; ask?: unknown }[] }[]) {
    const p = row?.spreadProfilePrices?.[0];
    const bid = Number(p?.bid);
    const ask = Number(p?.ask);
    if (bid > 0 && ask >= bid) mids.push((bid + ask) / 2);
  }
  if (!mids.length) return NaN;
  mids.sort((a, b) => a - b);
  const m = Math.floor(mids.length / 2);
  return mids.length % 2 ? mids[m] : (mids[m - 1] + mids[m]) / 2;
}

/**
 * How far to shift a proxy chart (gold token, futures) onto the spot price
 * brokers quote. 0 when either price is missing or the gap is implausible
 * (over 3%), so a bad quote can never move the levels far.
 */
export function spotOffset(spot: number, proxy: number): number {
  if (!(spot > 0) || !(proxy > 0)) return 0;
  const gap = spot - proxy;
  return Math.abs(gap) / proxy > 0.03 ? 0 : gap;
}

/**
 * The gap from a chart feed to the spot quote, or null when spot can't be
 * confirmed (no quote, no feed price, or more than 3% apart). Unlike
 * spotOffset, a confirmed gap of exactly 0 (the gold perpetual sitting right
 * on spot) still counts as confirmed.
 */
export function spotGap(spot: number, feed: number): { offset: number } | null {
  if (!(spot > 0) || !(feed > 0)) return null;
  const gap = spot - feed;
  return Math.abs(gap) / feed > 0.03 ? null : { offset: gap };
}

/** A candle series moved by a fixed amount (for spot-adjusted charts). */
export function shiftCandles<T extends { o: number; h: number; l: number; c: number }>(
  candles: T[],
  by: number,
): T[] {
  if (!by) return candles;
  return candles.map((c) => ({ ...c, o: c.o + by, h: c.h + by, l: c.l + by, c: c.c + by }));
}
