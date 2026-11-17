// The HFT lab's minute job: pull the last 1000 one-second candles for each
// market from Binance's public market-data mirror, score the trades that have
// fully played out (micro-scalp.ts) at Vantage's measured cost per trade, and
// save the scorecard in site_content "signals.microlab". It measures only:
// nothing is posted, copied or traded. The scorecard is never cleared.

import { cleanLab, scoreWindow, type MicroLabState, type Sec } from "./micro-scalp";

type Admin = { from: (t: string) => any };

/**
 * The scorecard. "signals.microlab" was the first version (counted with half
 * a spread too much credit and instant fills); it's kept as it is, never
 * deleted, and this one starts fresh with the corrected rules.
 */
export const MICROLAB_KEY = "signals.microlab.v2";

/** Each market's 1-second feed: bitcoin itself, and the gold token the tracker already uses for gold. */
export const MICRO_FEEDS: Record<string, string> = { BTCUSD: "BTCUSDT", XAUUSD: "PAXGUSDT" };
/** The same on OKX, used when Binance doesn't answer the live server (it logged "no data" every run, 2026-11-17). */
export const OKX_FEEDS: Record<string, string> = { BTCUSDT: "BTC-USDT", PAXGUSDT: "PAXG-USDT" };
/** The rapid-fire scorecard (rapid-scalp.ts), kept apart from the strategies' one. */
export const RAPIDLAB_KEY = "signals.rapidlab";
const FALLBACK_COST: Record<string, number> = { XAUUSD: 0.35, BTCUSD: 15 };

const RUN_EVERY_MS = 55_000;
/** Fewest seconds worth scoring: rapid fire needs about 340 (its 5-minute hold), the strategies 900. */
const MIN_SECONDS = 400;
const OKX_PAGE_GAP_MS = 300;
const OKX_RETRY_MS = 1000;
const OKX_RETRIES = 3;
/** At most this long on OKX per market per run, so the watch run keeps its time. */
const OKX_BUDGET_MS = 8000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Binance refuses the live server (HTTP 403): after a refusal it isn't asked again for this long. */
const BINANCE_REST_MS = 30 * 60_000;
let binanceRefusedAt = 0;

/**
 * Why each source last gave nothing (an HTTP status or the error), shown in
 * the lab's status line so a "no data" says what went wrong.
 */
const lastWhy: Record<string, string> = {};
const errText = (e: unknown) =>
  (e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    .replace(/https?:\/\/\S+/g, "")
    .slice(0, 80);
let lastRun = 0;

/**
 * The last 1000 seconds from OKX (300 a page, newest first, paged back with
 * "after"). OKX has no taker-buy split, so buyers and sellers count as even.
 */
async function okxSeconds(symbol: string): Promise<Sec[]> {
  const inst = OKX_FEEDS[symbol];
  if (!inst) return [];
  const rows: string[][] = [];
  let after = "";
  const until = Date.now() + OKX_BUDGET_MS;
  for (let page = 0; page < 4 && rows.length < 1000 && Date.now() < until; page++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      // OKX answers the live server "429 too many requests" now and then (the
      // host shares its addresses): a short pause between pages, and up to
      // three tries a page with a longer wait after a 429.
      if (page) await pause(OKX_PAGE_GAP_MS);
      let res = await fetch(
        `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=1s&limit=300${after ? `&after=${after}` : ""}`,
        { signal: ctrl.signal },
      );
      for (
        let retry = 1;
        res.status === 429 && retry <= OKX_RETRIES && Date.now() < until;
        retry++
      ) {
        await pause(OKX_RETRY_MS * retry);
        res = await fetch(
          `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=1s&limit=300${after ? `&after=${after}` : ""}`,
          { signal: ctrl.signal },
        );
      }
      if (!res.ok) {
        lastWhy.okx = `HTTP ${res.status}`;
        break;
      }
      const json = (await res.json()) as { code?: string; data?: string[][]; msg?: string };
      const data = json.code === "0" && Array.isArray(json.data) ? json.data : [];
      if (!data.length) {
        lastWhy.okx = `empty (code ${json.code ?? "?"}${json.msg ? ` ${json.msg}` : ""})`;
        break;
      }
      rows.push(...data);
      after = data[data.length - 1][0];
    } catch (e) {
      lastWhy.okx = errText(e);
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  const seen = new Set<number>();
  return rows
    .map((r) => ({ t: Number(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .filter((s) => {
      if (seen.has(s.t) || ![s.o, s.h, s.l, s.c].every((x) => Number.isFinite(x) && x > 0))
        return false;
      seen.add(s.t);
      return true;
    })
    .sort((a, b) => a.t - b.t);
}

/** Binance first, OKX when Binance gives nothing. Says which one it used. */
async function secondsFrom(symbol: string): Promise<{ secs: Sec[]; source: string }> {
  const b = Date.now() - binanceRefusedAt < BINANCE_REST_MS ? [] : await binanceSeconds(symbol);
  if (b.length >= 900) return { secs: b, source: "binance" };
  const o = await okxSeconds(symbol);
  return { secs: o, source: "okx" };
}

async function binanceSeconds(symbol: string): Promise<Sec[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1s&limit=1000`,
      { signal: ctrl.signal },
    );
    if (!res.ok) {
      lastWhy.binance = `HTTP ${res.status}`;
      if (res.status === 403 || res.status === 451) binanceRefusedAt = Date.now();
      return [];
    }
    const rows = (await res.json()) as unknown[][];
    if (!Array.isArray(rows) || rows.length < 900)
      lastWhy.binance = `only ${Array.isArray(rows) ? rows.length : 0} rows`;
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
  } catch (e) {
    lastWhy.binance = errText(e);
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

export async function loadRapid(admin: Admin) {
  const { cleanRapid } = await import("./rapid-scalp");
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", RAPIDLAB_KEY)
    .maybeSingle();
  try {
    return cleanRapid(JSON.parse((data as { value?: string } | null)?.value ?? "{}"));
  } catch {
    return cleanRapid({});
  }
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
    const rapid = await loadRapid(admin);
    const { scoreRapid } = await import("./rapid-scalp");
    const { costPerTrade } = await import("./broker-quotes.server");
    const parts: string[] = [];
    for (const [market, symbol] of Object.entries(MICRO_FEEDS)) {
      if (market === "XAUUSD" && (await goldShut(now))) {
        parts.push(`${market}: closed`);
        continue;
      }
      const { secs, source } = await secondsFrom(symbol);
      if (secs.length < MIN_SECONDS) {
        parts.push(
          `${market}: no data (binance ${lastWhy.binance ?? "?"}; okx ${lastWhy.okx ?? "?"}; ${secs.length} rows)`,
        );
        continue;
      }
      const cost = await costPerTrade(market, FALLBACK_COST[market]).catch(
        () => FALLBACK_COST[market],
      );
      const m = (state.markets[market] ??= { done: {}, stats: {} });
      const rm = (rapid.markets[market] ??= { done: 0, next: 0, stats: {} });
      const fast = scoreRapid(rm, secs, cost, market);
      parts.push(`${market}: ${scoreWindow(m, secs, cost)} (+${fast} rapid, ${source})`);
    }
    rapid.updatedAt = now;
    state.updatedAt = now;
    const at = new Date(now).toISOString();
    await admin
      .from("site_content")
      .upsert(
        { key: MICROLAB_KEY, value: JSON.stringify(state), updated_at: at },
        { onConflict: "key" },
      );
    await admin
      .from("site_content")
      .upsert(
        { key: RAPIDLAB_KEY, value: JSON.stringify(rapid), updated_at: at },
        { onConflict: "key" },
      );
    return parts.join(", ");
  } catch (e) {
    console.warn("[microlab]", e);
    return "error";
  }
}
