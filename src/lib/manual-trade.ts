// Manual trades the Boss places from Telegram in plain terms (the Boss,
// 2026-11-12): pick the market and side, then either a lot size or an account
// risk %, and a stop and take-profit distance. The maths here is pure so it can
// be tested; the bot (manual-trade-bot) and the copier place the order. Gold is
// tighter than bitcoin because its moves are far smaller.

export type Market = "XAUUSD" | "BTCUSD";

/**
 * Vantage Standard STP value: dollars gained or lost per 1.0 lot for each $1
 * the price moves. Gold is 100oz a lot ($100 per $1), bitcoin 1 coin a lot
 * ($1 per $1). Used to turn an account-risk % into a lot size. The Boss can
 * still just name a lot and skip this.
 */
export const CONTRACT_VALUE: Record<Market, number> = { XAUUSD: 100, BTCUSD: 1 };

export const MARKET_LABEL: Record<Market, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };

/**
 * Plain-language stop/target distances in price (dollars), gold tighter than
 * bitcoin. `sl`/`tp` are the defaults; the rest clamp a typed-in distance so a
 * slip of the finger can't place a crazy stop. The step is how far the ➖/➕
 * buttons move it.
 */
export const MANUAL_DEFAULTS: Record<
  Market,
  {
    sl: number;
    tp: number;
    minSl: number;
    maxSl: number;
    minTp: number;
    maxTp: number;
    step: number;
  }
> = {
  XAUUSD: { sl: 3, tp: 6, minSl: 0.5, maxSl: 30, minTp: 0.5, maxTp: 60, step: 0.5 },
  BTCUSD: { sl: 300, tp: 600, minSl: 50, maxSl: 3000, minTp: 50, maxTp: 6000, step: 50 },
};

/** The most a manual lot can be, so a mistyped risk can't open the account up. */
export const MAX_MANUAL_LOT = 5;
export const MIN_MANUAL_LOT = 0.01;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Keep a stop distance inside the market's sane range. */
export function clampSl(market: Market, d: number): number {
  const m = MANUAL_DEFAULTS[market];
  return round2(clamp(d, m.minSl, m.maxSl));
}
/** Keep a take-profit distance inside the market's sane range. */
export function clampTp(market: Market, d: number): number {
  const m = MANUAL_DEFAULTS[market];
  return round2(clamp(d, m.minTp, m.maxTp));
}

/**
 * The lot for an account-risk %: risk the given share of the balance over the
 * stop distance, using the market's contract value. Clamped to a safe lot and
 * rounded to 0.01. Returns 0 when the inputs don't make sense.
 */
export function manualLot(
  market: Market,
  balance: number,
  riskPct: number,
  slDistance: number,
): number {
  if (!(balance > 0) || !(riskPct > 0) || !(slDistance > 0)) return 0;
  const riskAmount = balance * (riskPct / 100);
  const perLot = slDistance * CONTRACT_VALUE[market];
  if (!(perLot > 0)) return 0;
  const lot = riskAmount / perLot;
  // Round DOWN to 0.01 so the risk is never more than asked, then clamp.
  const floored = Math.floor(lot * 100) / 100;
  if (floored < MIN_MANUAL_LOT) return 0;
  return Math.min(MAX_MANUAL_LOT, floored);
}

export type ManualInput = {
  market: Market;
  direction: "BUY" | "SELL";
  price: number;
  slDistance: number;
  tpDistance: number;
  /** Either a fixed lot, or an account risk % with the balance to size from. */
  lot?: number;
  riskPct?: number;
  balance?: number;
};

export type ManualTrade = {
  market: Market;
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp: number;
  lot: number;
  /** How the lot was decided, for the confirm card. */
  lotFrom: "fixed" | "risk";
  /** The dollars at risk if the stop is hit (risk sizing only), else null. */
  riskAmount: number | null;
  /** Reward-to-risk of the take profit. */
  rr: number;
};

/**
 * Work out the entry, stop, take profit and lot for a manual trade. The entry
 * is the price now; the stop and target sit the given distances away on the
 * right sides. The lot is the Boss's fixed lot, or sized from the account risk.
 * Returns null when there's no usable lot (e.g. the risk is too small to open
 * even 0.01, or nothing was given). Pure.
 */
export function buildManualTrade(input: ManualInput): ManualTrade | null {
  const { market, direction } = input;
  const price = input.price;
  if (!(price > 0)) return null;
  const side = direction === "BUY" ? 1 : -1;
  const sl = clampSl(market, input.slDistance);
  const tp = clampTp(market, input.tpDistance);
  const stop = round2(price - side * sl);
  const target = round2(price + side * tp);

  let lot = 0;
  let lotFrom: "fixed" | "risk" = "fixed";
  let riskAmount: number | null = null;
  if (input.lot && input.lot > 0) {
    lot = Math.min(MAX_MANUAL_LOT, Math.max(MIN_MANUAL_LOT, round2(input.lot)));
    lotFrom = "fixed";
  } else if (input.riskPct && input.balance) {
    lot = manualLot(market, input.balance, input.riskPct, sl);
    lotFrom = "risk";
    riskAmount = lot > 0 ? round2(lot * sl * CONTRACT_VALUE[market]) : null;
  }
  if (!(lot > 0)) return null;

  return {
    market,
    direction,
    entry: round2(price),
    stop,
    tp: target,
    lot,
    lotFrom,
    riskAmount,
    rr: round2(tp / sl),
  };
}
