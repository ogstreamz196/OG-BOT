// The HFT lab's minute job: pull the last 1000 one-second candles for each
// market from Binance's public market-data mirror, score the trades that have
// fully played out (micro-scalp.ts) at Vantage's measured cost per trade, and
// save the scorecard in site_content "signals.microlab". It measures only:
// nothing is posted, copied or traded. The scorecard is never cleared.

import { cleanLab, scoreWindow, type MicroLabState, type Sec } from "./micro-scalp";

type Admin = { from: (t: string) => any };

export const MICROLAB_KEY = "signals.microlab";

/** Each market's 1-second feed: bitcoin itself, and the gold token the tracker already uses for gold. */
export const MICRO_FEEDS: Record<string, string> = { BTCUSD: "BTCUSDT", XAUUSD: "PAXGUSDT" };
const FALLBACK_COST: Record<string, number> = { XAUUSD: 0.35, BTCUSD: 15 };

const RUN_EVERY_MS = 55_000;
let lastRun = 0;

async function seconds(symbol: string): Promise<Sec[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1s&limit=1000`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[][];
    return rows
      .map((r) => ({
        t: Number(r[0]),
        o: +String(r[1]),
        h: +String(r[2]),
        l: +String(r[3]),
        c: +String(r[4]),
        v: +String(r[5]),
        tb: +String(r[9]),
      }))
      .filter((s) => [s.o, s.h, s.l, s.c].every((x) => Number.isFinite(x) && x > 0));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Gold's broker hours (Friday 10pm to Sunday 11pm UK shut); the token trades all weekend but Vantage doesn't. */
async function goldShut(now: number): Promise<boolean> {
  const { sessionRead } = await import("./trade-signal");
  return !!sessionRead({ asset: "forex", label: "gold", code: "XAUUSD" }, now).closed;
}

export async function loadLab(admin: Admin): Promise<MicroLabState> {
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", MICROLAB_KEY)
    .maybeSingle();
  try {
    return cleanLab(JSON.parse((data as { value?: string } | null)?.value ?? "{}"));
  } catch {
    return cleanLab({});
  }
}

/**
 * Once a minute (from the watch route): score the new trades for each market
 * and save. Returns a short status for the route's JSON. Never throws.
 */
export async function maybeRunMicroLab(admin: Admin, now = Date.now()): Promise<string> {
  if (now - lastRun < RUN_EVERY_MS) return "waiting";
  lastRun = now;
  try {
    const state = await loadLab(admin);
    const { costPerTrade } = await import("./broker-quotes.server");
    const parts: string[] = [];
    for (const [market, symbol] of Object.entries(MICRO_FEEDS)) {
      if (market === "XAUUSD" && (await goldShut(now))) {
        parts.push(`${market}: closed`);
        continue;
      }
      const secs = await seconds(symbol);
      if (secs.length < 900) {
        parts.push(`${market}: no data`);
        continue;
      }
      const cost = await costPerTrade(market, FALLBACK_COST[market]).catch(
        () => FALLBACK_COST[market],
      );
      const m = (state.markets[market] ??= { done: {}, stats: {} });
      parts.push(`${market}: ${scoreWindow(m, secs, cost)}`);
    }
    state.updatedAt = now;
    const at = new Date(now).toISOString();
    await admin
      .from("site_content")
      .upsert(
        { key: MICROLAB_KEY, value: JSON.stringify(state), updated_at: at },
        { onConflict: "key" },
      );
    return parts.join(", ");
  } catch (e) {
    console.warn("[microlab]", e);
    return "error";
  }
}
