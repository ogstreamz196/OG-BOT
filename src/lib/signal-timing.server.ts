// How late the auto-posted alerts are: for each one, when its entry candle
// closed, when the signal was built, when it went out and where price was by
// then (feeds.timing). The Boss's signal report turns these into the delay,
// how far price had already moved, and how long entries take to fill and
// trades take to finish.

/** The entry chart's candle: alerts are 5-minute scalps. */
const CANDLE_MS = 5 * 60_000;

export type AlertTiming = {
  /** When the last entry candle before posting closed (ms). */
  candleAt: number;
  /** When the signal was built, if known (ms). */
  builtAt?: number;
  postedAt: number;
  /** The live price (spot for gold) when it went out. */
  pricePosted?: number;
};

type Alert = {
  plan?: { market: string };
  summary?: { builtAt?: string; price?: number };
};

/** The timing to keep with an alert that just went out. Never throws. */
export async function alertTiming(signal: Alert, postedAt: number): Promise<AlertTiming | null> {
  if (!signal.plan) return null;
  const built = Date.parse(signal.summary?.builtAt ?? "");
  let price = NaN;
  try {
    const { detectTradeIntent } = await import("./trade-signal");
    const ctx = await import("./trade-signal-context.server");
    const inst = detectTradeIntent(`${signal.plan.market} signal 5m`);
    if (inst) price = inst.spot ? await ctx.spotPrice(inst) : await ctx.livePrice(inst);
  } catch {
    /* no live price: the rest still counts */
  }
  return {
    candleAt: Math.floor(postedAt / CANDLE_MS) * CANDLE_MS,
    ...(Number.isFinite(built) ? { builtAt: built } : {}),
    postedAt,
    ...(Number.isFinite(price) && price > 0 ? { pricePosted: price } : {}),
  };
}
