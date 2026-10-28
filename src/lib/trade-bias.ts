// "Market bias": when the engine finds no clean setup, OG B0T still reads the
// chart's recent highs and lows and gives the side it leans, as a risky call
// likely to trigger within the next 5 minutes. It's labelled as bias, not a
// signal, and never counts in the results book.
import { atr, type Candle } from "./trade-signal";

export type BiasRead = {
  direction: "BUY" | "SELL";
  entry: number;
  /** market: enter now. stop: enter on a small break, expected within ~5 minutes. */
  entryType: "market" | "stop";
  stop: number;
  targets: [number, number, number];
  /** Plain-English reasons from the highs and lows, e.g. "higher highs and higher lows". */
  reasons: string[];
};

/** Members' stop sits this much further out than the swing (matches STOP_ROOM). */
const ROOM = 1.2;

function swings(candles: Candle[]) {
  const half = Math.floor(candles.length / 2);
  const early = candles.slice(0, half);
  const late = candles.slice(half);
  const hi = (cs: Candle[]) => Math.max(...cs.map((c) => c.h));
  const lo = (cs: Candle[]) => Math.min(...cs.map((c) => c.l));
  return { earlyHigh: hi(early), earlyLow: lo(early), lateHigh: hi(late), lateLow: lo(late) };
}

/**
 * The side the recent highs and lows lean, with entry, stop and targets.
 * `recent` are short candles (5-minute when available), oldest first.
 * `prevDay` is yesterday's high/low; `levels` are the engine's support and
 * resistance; `lean` is the engine's own direction, used to break a tie.
 */
export function marketBias(opts: {
  recent: Candle[];
  price: number;
  prevDay?: { h: number; l: number } | null;
  levels?: number[];
  lean: "BUY" | "SELL";
}): BiasRead | null {
  const recent = opts.recent.filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l));
  if (recent.length < 12 || !Number.isFinite(opts.price) || opts.price <= 0) return null;
  const window = recent.slice(-36);
  const a = atr(window, 14);
  if (!Number.isFinite(a) || a <= 0) return null;
  const price = opts.price;

  // 1) Structure: higher highs and lows, or lower highs and lows.
  const s = swings(window);
  const reasons: string[] = [];
  let vote = 0;
  if (s.lateHigh > s.earlyHigh && s.lateLow > s.earlyLow) {
    vote += 2;
    reasons.push("higher highs and higher lows");
  } else if (s.lateHigh < s.earlyHigh && s.lateLow < s.earlyLow) {
    vote -= 2;
    reasons.push("lower highs and lower lows");
  }
  // 2) Where price sits in yesterday's range.
  const pd = opts.prevDay;
  if (pd && pd.h > pd.l) {
    if (price > pd.h) {
      vote += 1;
      reasons.push("trading above yesterday's high");
    } else if (price < pd.l) {
      vote -= 1;
      reasons.push("trading below yesterday's low");
    } else if (price > (pd.h + pd.l) / 2) {
      vote += 1;
      reasons.push("upper half of yesterday's range");
    } else {
      vote -= 1;
      reasons.push("lower half of yesterday's range");
    }
  }
  // 3) Where price sits in the recent range.
  const rangeHigh = Math.max(s.earlyHigh, s.lateHigh);
  const rangeLow = Math.min(s.earlyLow, s.lateLow);
  if (rangeHigh > rangeLow) {
    const pos = (price - rangeLow) / (rangeHigh - rangeLow);
    if (pos >= 0.6) {
      vote += 1;
      reasons.push("near the top of the last few hours' range");
    } else if (pos <= 0.4) {
      vote -= 1;
      reasons.push("near the bottom of the last few hours' range");
    }
  }
  const long = vote > 0 ? true : vote < 0 ? false : opts.lean === "BUY";
  if (vote === 0) reasons.push("no clear edge, going with the trend lean");
  const side = long ? 1 : -1;

  // Entry: a small break of the last candle, which usually trades inside 5
  // minutes; if price is already past it, just go now.
  const last = window[window.length - 1];
  const trigger = long ? last.h + a * 0.05 : last.l - a * 0.05;
  const gap = (trigger - price) * side;
  const breakEntry = gap > 0 && gap <= a * 0.3;
  const entry = breakEntry ? trigger : price;

  // Stop beyond the nearest recent swing, kept between 0.6 and 2 ATR, then
  // given the members' extra room.
  const swing = long
    ? Math.min(...window.slice(-12).map((c) => c.l))
    : Math.max(...window.slice(-12).map((c) => c.h));
  let risk = Math.abs(entry - swing) + a * 0.1;
  risk = Math.min(Math.max(risk, a * 0.6), a * 2);
  const stop = entry - side * risk * ROOM;

  // Targets: the highs and lows in the way (recent range, yesterday, engine
  // levels), else 1R / 2R / 3R, always in order and at least 0.5R apart.
  const ahead = [rangeHigh, rangeLow, ...(pd ? [pd.h, pd.l] : []), ...(opts.levels ?? [])]
    .filter((l) => Number.isFinite(l) && (l - entry) * side >= risk * 0.8)
    .sort((x, y) => (x - entry) * side - (y - entry) * side);
  const targets: number[] = [];
  for (const r of [1, 2, 3]) {
    const prev = targets.length ? (targets[targets.length - 1] - entry) * side : 0;
    const level = ahead.find((l) => (l - entry) * side >= Math.max(prev + risk * 0.5, risk * 0.8));
    const dist = level != null ? (level - entry) * side : Math.max(r * risk, prev + risk * 0.5);
    targets.push(entry + side * dist);
  }
  return {
    direction: long ? "BUY" : "SELL",
    entry,
    entryType: breakEntry ? "stop" : "market",
    stop,
    targets: [targets[0], targets[1], targets[2]],
    reasons,
  };
}

/**
 * Dollars a 1.0 lot makes per 1.0 move in price, or null when the contract
 * size isn't standard enough to say (indices, oil, stocks).
 */
export function usdPerLotMove(market: string, price: number): number | null {
  const m = market.toUpperCase();
  if (m === "XAUUSD") return 100; // 100 oz
  if (m === "XAGUSD") return 5000; // 5,000 oz
  if (/^(BTC|ETH|SOL|XRP|LTC|BNB|ADA|DOGE|AVAX|DOT|LINK)USD$/.test(m)) return 1; // 1 coin
  if (/^[A-Z]{3}USD$/.test(m)) return 100_000; // 100k units, quote in dollars
  if (/^USD[A-Z]{3}$/.test(m) && price > 0) return 100_000 / price; // quote converted back
  return null;
}

/** What 1.0 lot on a $500 account would be up after moving from entry to `to`. */
export function lotWin(
  market: string,
  direction: "BUY" | "SELL",
  entry: number,
  to: number,
  equity = 500,
): { profit: number; balance: number; pct: number } | null {
  const per = usdPerLotMove(market, to);
  if (per == null) return null;
  const profit = (direction === "BUY" ? to - entry : entry - to) * per;
  if (!(profit > 0)) return null;
  return { profit, balance: equity + profit, pct: (profit / equity) * 100 };
}
