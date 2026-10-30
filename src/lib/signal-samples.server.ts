// The learning loop's growing history. Every setup the learning loop replays
// is kept in signal_learn_samples, so each study only has to replay what's new
// since the last one (plus a week further back each time, until the history
// reaches LEARN_DAYS), instead of replaying the same 14 days from scratch.
// The loop then learns from everything kept, up to LEARN_DAYS (90 days).
//
// Samples are tuning-free (raw levels, the candles after, the setups showing),
// so they stay valid whatever the loop learns; only a change to the chart
// engine itself makes them stale: bump SAMPLE_VERSION then, and the history
// rebuilds itself under the new version. Without the table, the loop falls
// back to replaying the last REPLAY_DAYS each time, as before.
import {
  collectSamples,
  fetchBinanceHistory,
  historyNeeded,
  type LearnSample,
} from "./trade-signal-backtest";
import type { CandleSets, Instrument } from "./trade-signal";

type Admin = any;

const TABLE = "signal_learn_samples";
/** Bump when buildPlan / collectSamples change what a sample holds. */
export const SAMPLE_VERSION = 1;
/** How far back the loop learns from, once the history is built. */
export const LEARN_DAYS = 90;
/** What's replayed when nothing's kept yet (or there's no table). */
export const REPLAY_DAYS = 14;
/** How much older history each study adds, until LEARN_DAYS is reached. */
export const BACKFILL_DAYS = 7;
/** Samples older than this are deleted. */
const KEEP_DAYS = 120;
const DAY = 86_400_000;
/** A setup every 30 minutes of the period. */
const SAMPLE_STEP = 6;

export type HistoryMarket = {
  code: string;
  /** Binance spot symbol (PAX Gold for gold, bitcoin's own). */
  symbol: string;
  /** The real market's perpetual, tried first (gold: XAUUSDT). */
  futures?: string;
};

/** Every candle the replay of [from, to) needs, the perpetual first. */
async function candleSets(
  m: HistoryMarket,
  from: number,
  to: number,
  fetcher: typeof fetch,
): Promise<{ sets: CandleSets; start: number }> {
  const days = Math.max(1, (to - from) / DAY);
  const { start, need } = historyNeeded("5M", days, to);
  const load = async (futures: boolean) => {
    const sets: CandleSets = { daily: [], hourly: [], fifteen: [], five: [], minute: [] };
    for (const [key, at] of Object.entries(need) as [keyof CandleSets, number][])
      sets[key] = await fetchBinanceHistory(futures ? m.futures! : m.symbol, key, at, to, fetcher, {
        futures,
      });
    return sets;
  };
  // The whole replay comes from one feed, so its timeframes always match.
  if (m.futures) {
    try {
      return { sets: await load(true), start };
    } catch {
      /* the perpetual's unreachable: the proxy token instead */
    }
  }
  return { sets: await load(false), start };
}

/** Replays [from, to) into samples. */
export async function replay(
  m: HistoryMarket,
  inst: Instrument | undefined,
  from: number,
  to: number,
  fetcher: typeof fetch = fetch,
): Promise<LearnSample[]> {
  if (to - from < 3600_000) return [];
  const { sets, start } = await candleSets(m, from, to, fetcher);
  return collectSamples({
    sets,
    frame: "5M",
    from: Math.max(start, from),
    to,
    inst,
    step: SAMPLE_STEP,
  });
}

/** The [from, to) ranges still to replay, given what's kept (pure, for tests). */
export function rangesToReplay(
  kept: { oldest: number; newest: number } | null,
  now: number,
): [number, number][] {
  if (!kept) return [[now - REPLAY_DAYS * DAY, now]];
  const out: [number, number][] = [[kept.newest + 1, now]];
  const floor = now - LEARN_DAYS * DAY;
  if (kept.oldest > floor + DAY)
    out.push([Math.max(floor, kept.oldest - BACKFILL_DAYS * DAY), kept.oldest]);
  return out;
}

/**
 * The samples to learn from for a market: what's kept, topped up with what's
 * new and a week further back, up to LEARN_DAYS. Falls back to a plain
 * REPLAY_DAYS replay without the table. Says how many days it covers.
 */
export async function gatherSamples(
  admin: Admin,
  m: HistoryMarket,
  inst: Instrument | undefined,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<{ samples: LearnSample[]; days: number; added: number }> {
  const span = (rows: LearnSample[]) =>
    rows.length ? Math.max(1, Math.round((rows.at(-1)!.t - rows[0].t) / DAY)) : 0;
  const bound = async (asc: boolean) =>
    admin
      .from(TABLE)
      .select("t")
      .eq("market", m.code)
      .eq("version", SAMPLE_VERSION)
      .gte("t", now - LEARN_DAYS * DAY)
      .order("t", { ascending: asc })
      .limit(1);
  const [oldest, newest] = await Promise.all([bound(true), bound(false)]).catch(
    () => [{ error: true }, { error: true }] as { data?: unknown; error: unknown }[],
  );
  if (oldest.error || newest.error) {
    // No table yet: replay the recent past, as before.
    const samples = await replay(m, inst, now - REPLAY_DAYS * DAY, now, fetcher);
    return { samples, days: REPLAY_DAYS, added: 0 };
  }
  const o = (oldest.data as { t: number }[] | null)?.[0];
  const n = (newest.data as { t: number }[] | null)?.[0];
  const kept = o && n ? { oldest: Number(o.t), newest: Number(n.t) } : null;

  let added = 0;
  for (const [from, to] of rangesToReplay(kept, now)) {
    const fresh = await replay(m, inst, from, to, fetcher).catch(() => [] as LearnSample[]);
    for (let i = 0; i < fresh.length; i += 200) {
      const rows = fresh.slice(i, i + 200).map((s) => ({
        market: m.code,
        version: SAMPLE_VERSION,
        t: s.t,
        sample: s,
      }));
      const { error } = await admin
        .from(TABLE)
        .upsert(rows, { onConflict: "market,version,t", ignoreDuplicates: true });
      if (!error) added += rows.length;
    }
  }
  await admin
    .from(TABLE)
    .delete()
    .eq("market", m.code)
    .lt("t", now - KEEP_DAYS * DAY);

  const samples: LearnSample[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await admin
      .from(TABLE)
      .select("sample")
      .eq("market", m.code)
      .eq("version", SAMPLE_VERSION)
      .gte("t", now - LEARN_DAYS * DAY)
      .order("t", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) break;
    const rows = (data ?? []) as { sample: LearnSample }[];
    for (const r of rows) samples.push(r.sample);
    if (rows.length < 1000) break;
  }
  return { samples, days: span(samples), added };
}
