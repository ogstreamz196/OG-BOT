// Vantage's own prices and spread, through the MetaApi connection to the
// Boss's MT5 account (mt5-autotrade.server.ts). Without MetaApi set up
// everything here returns nothing and the bot works as before.
//
// - brokerQuote: Vantage's live bid and ask for gold or bitcoin (cached 5s).
// - The spread model: once a minute the watcher records each market's spread
//   (recordSpreads), kept as a running average per UK hour of the week, plus
//   the latest reading; site_content "signals.spreads".
// - spreadAt: the typical spread for a moment (the hour-of-week average, else
//   the market's overall average, else the hand-set SPREAD_COST), which the
//   learning loop charges every trade; currentSpread: the latest reading, for
//   the spread guard.
// - commission: Raw/Pro ECN accounts pay a commission per lot as well
//   (site_content "mt5.commissionPerLot", USD per 1.0 lot round turn; 0 on a
//   Standard account), turned into price by the contract size.

type Admin = any;

export const SPREADS_KEY = "signals.spreads";
export const COMMISSION_KEY = "mt5.commissionPerLot";
/** Contract size per 1.0 lot at Vantage: gold 100 oz, bitcoin 1 BTC. */
export const CONTRACT_SIZE: Record<string, number> = { XAUUSD: 100, BTCUSD: 1 };
/** Readings averaged per bucket before older ones fade (an exponential average). */
const BUCKET_MEMORY = 120;
/** A reading older than this isn't "now". */
const CURRENT_MS = 3 * 60_000;

export type Quote = { bid: number; ask: number; mid: number; spread: number };

const quoteCache = new Map<string, { exp: number; value: Quote | null }>();

/** Vantage's live bid and ask for a market, or null (no MetaApi, closed, or slow). */
export async function brokerQuote(market: string): Promise<Quote | null> {
  const hit = quoteCache.get(market);
  if (hit && hit.exp > Date.now()) return hit.value;
  const { metaApi, metaApiConfigured, brokerSymbol } = await import("./mt5-autotrade.server");
  if (!metaApiConfigured()) return null;
  const res = await metaApi<{ bid?: number; ask?: number }>(
    `/symbols/${encodeURIComponent(brokerSymbol(market))}/current-price`,
    { timeoutMs: 2_500 },
  );
  const bid = Number(res.data?.bid);
  const ask = Number(res.data?.ask);
  const value =
    res.ok && bid > 0 && ask >= bid && (ask - bid) / bid < 0.02
      ? { bid, ask, mid: (bid + ask) / 2, spread: ask - bid }
      : null;
  quoteCache.set(market, { exp: Date.now() + (value ? 5_000 : 30_000), value });
  return value;
}

/* ── The spread model ─────────────────────────────────────────────────── */

type Bucket = { avg: number; n: number; max: number };
export type SpreadModel = {
  v: 1;
  markets: Record<
    string,
    { buckets: Record<string, Bucket>; overall?: Bucket; last?: { spread: number; at: number } }
  >;
};

/** The UK hour of the week a moment falls in, e.g. "Mon-14". */
export function weekHour(t: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday}-${Number(p.hour)}`;
}

export function parseSpreads(value: string | null | undefined): SpreadModel {
  try {
    const v = JSON.parse(value ?? "") as SpreadModel;
    if (v && v.v === 1 && v.markets) return v;
  } catch {
    /* nothing recorded yet */
  }
  return { v: 1, markets: {} };
}

const fold = (b: Bucket | undefined, x: number): Bucket => {
  const n = Math.min((b?.n ?? 0) + 1, BUCKET_MEMORY);
  const avg = b ? b.avg + (x - b.avg) / n : x;
  return { avg, n, max: Math.max(b?.max ?? 0, x) };
};

/** A reading folded into the model (pure, so it can be tested). */
export function addReading(
  model: SpreadModel,
  market: string,
  spread: number,
  at: number,
): SpreadModel {
  const m = (model.markets[market] ??= { buckets: {} });
  const key = weekHour(at);
  m.buckets[key] = fold(m.buckets[key], spread);
  m.overall = fold(m.overall, spread);
  m.last = { spread, at };
  return model;
}

/**
 * The typical spread at a moment, in price: that hour of the week's average
 * once it has a few readings, else the market's overall average, else null.
 */
export function typicalSpread(model: SpreadModel, market: string, t: number): number | null {
  const m = model.markets[market];
  if (!m) return null;
  const b = m.buckets[weekHour(t)];
  if (b && b.n >= 5) return b.avg;
  return m.overall && m.overall.n >= 5 ? m.overall.avg : null;
}

/** The latest reading if it's fresh, in price. */
export function latestSpread(model: SpreadModel, market: string, now: number): number | null {
  const last = model.markets[market]?.last;
  return last && now - last.at <= CURRENT_MS ? last.spread : null;
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** Records gold's and bitcoin's spread at Vantage (once a minute, from the watcher). Never throws. */
export async function recordSpreads(admin: Admin, now = Date.now()): Promise<string> {
  try {
    const quotes = await Promise.all(
      ["XAUUSD", "BTCUSD"].map(async (m) => [m, await brokerQuote(m)] as const),
    );
    const live = quotes.filter(([, q]) => q);
    if (!live.length) return "no quotes";
    const model = parseSpreads(await setting(admin, SPREADS_KEY));
    for (const [m, q] of live) addReading(model, m, q!.spread, now);
    await admin
      .from("site_content")
      .upsert(
        { key: SPREADS_KEY, value: JSON.stringify(model), updated_at: new Date(now).toISOString() },
        { onConflict: "key" },
      );
    return live.map(([m, q]) => `${m} ${q!.spread.toFixed(m === "BTCUSD" ? 1 : 2)}`).join(", ");
  } catch {
    return "failed";
  }
}

/** The spread model (cached a minute). */
export async function spreadModel(): Promise<SpreadModel> {
  try {
    const { cached } = await import("./server-cache");
    return await cached("signal-spreads", 60_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return parseSpreads(await setting(supabaseAdmin, SPREADS_KEY));
    });
  } catch {
    return { v: 1, markets: {} };
  }
}

/** The commission per trade, in price (0 on a Standard account or when unset). Cached a minute. */
export async function commissionPrice(market: string): Promise<number> {
  try {
    const { cached } = await import("./server-cache");
    const perLot = await cached("mt5-commission", 60_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const v = Number(await setting(supabaseAdmin, COMMISSION_KEY));
      return Number.isFinite(v) && v > 0 && v < 1000 ? v : 0;
    });
    return perLot / (CONTRACT_SIZE[market] ?? 1);
  } catch {
    return 0;
  }
}

/**
 * What one trade costs at Vantage, in price: the measured average spread
 * (else the hand-set typical one) plus any commission. For the report, the
 * alert bar and the filter learning.
 */
export async function costPerTrade(market: string, fallback: number): Promise<number> {
  const [model, fee] = await Promise.all([spreadModel(), commissionPrice(market)]);
  const m = model.markets[market]?.overall;
  return (m && m.n >= 5 ? m.avg : fallback) + fee;
}
