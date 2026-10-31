// The filters learn too. Each thing that stops a setup being sent (a choppy
// market, mixed timeframes, no room to the next level, too quiet, a losing
// time of day, a blackout, a pair check, the AI desk saying no) has its blocked
// setups followed silently as shadow trades. Every FILTER_STUDY_MS, per market:
//
// - a filter still on is RELAXED (switched off for that market) when its
//   shadow trades over the last 30 days won at least RELAX_WIN_RATE of
//   RELAX_MIN_DECIDED+ decided trades and made money after the spread: it's
//   been blocking winners;
// - a relaxed filter is TIGHTENED again (switched back on) when the live
//   trades it let through (feeds.relaxed) lose: under TIGHTEN_WIN_RATE, or
//   money lost after the spread, over TIGHTEN_MIN_DECIDED+ decided trades.
//
// The confidence floor and the alert bar have their own learning and aren't
// here. Kept in site_content "signals.filters"; live signals read it through
// relaxedFilters (cached 10 minutes). No AI is involved.
import { SPREAD_COST } from "./signal-learning.server";
import { SHADOW_REASONS, type ShadowReason } from "./signal-shadows.server";

type Admin = any;

export const FILTERS_KEY = "signals.filters";
const RUN_KEY = "signals.filters.lastRun";
export const FILTER_STUDY_MS = 2 * 3600_000;
export const RELAX_MIN_DECIDED = 15;
export const RELAX_WIN_RATE = 0.55;
export const TIGHTEN_MIN_DECIDED = 10;
export const TIGHTEN_WIN_RATE = 0.45;
const DAYS = 30;
const MARKETS = ["XAUUSD", "BTCUSD"];

/** The filters that can learn to switch off (the floor and the alert bar learn elsewhere). */
export const LEARNED_FILTERS = [
  "choppy",
  "mixed",
  "no_room",
  "quiet",
  "losing_hours",
  "blackout",
  "trial_check",
  "desk_no",
] as const satisfies readonly ShadowReason[];
export type LearnedFilter = (typeof LEARNED_FILTERS)[number];

export type FilterRecord = { wins: number; losses: number; net: number };
export type FilterState = {
  relaxed: boolean;
  since?: string;
  /** What decided it last: the shadow trades (while on) or the live trades it let through (while relaxed). */
  shadow?: FilterRecord;
  live?: FilterRecord;
};
export type FiltersState = {
  v: 1;
  markets: Record<string, Partial<Record<LearnedFilter, FilterState>>>;
  lastRunAt?: string;
};

/** One finished trade for a filter: how it ended and the pips it made or lost. */
export type FilterTrade = { outcome: "win" | "loss" | "flat"; pips: number };

const tally = (trades: FilterTrade[], spread: number): FilterRecord => ({
  wins: trades.filter((t) => t.outcome === "win").length,
  losses: trades.filter((t) => t.outcome === "loss").length,
  net: Math.round(trades.reduce((n, t) => n + t.pips - spread, 0) * 10) / 10,
});

/**
 * A filter's next state from its shadow trades (while on) or the live trades
 * it let through (while relaxed). Pure, so it can be tested.
 */
export function nextFilterState(
  had: FilterState | undefined,
  shadow: FilterTrade[],
  live: FilterTrade[],
  spread: number,
  now: number,
): FilterState {
  const at = new Date(now).toISOString();
  if (!had?.relaxed) {
    const s = tally(shadow, spread);
    const decided = s.wins + s.losses;
    const relax = decided >= RELAX_MIN_DECIDED && s.wins / decided >= RELAX_WIN_RATE && s.net > 0;
    return relax
      ? { relaxed: true, since: at, shadow: s }
      : { relaxed: false, since: had?.since, shadow: s };
  }
  const l = tally(live, spread);
  const decided = l.wins + l.losses;
  const tighten =
    decided >= TIGHTEN_MIN_DECIDED && (l.wins / decided < TIGHTEN_WIN_RATE || l.net < 0);
  return tighten
    ? { relaxed: false, since: at, live: l }
    : { relaxed: true, since: had.since, shadow: had.shadow, live: l };
}

export function parseFilters(value: string | null | undefined): FiltersState {
  try {
    const v = JSON.parse(value ?? "") as FiltersState;
    if (v && v.v === 1 && v.markets && typeof v.markets === "object") return v;
  } catch {
    /* nothing learned yet */
  }
  return { v: 1, markets: {} };
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

async function save(admin: Admin, key: string, value: string) {
  const at = new Date().toISOString();
  await admin.from("site_content").upsert({ key, value, updated_at: at }, { onConflict: "key" });
}

/** The filters switched off for a market right now (cached 10 minutes). Never throws. */
export async function relaxedFilters(market: string): Promise<Set<LearnedFilter>> {
  try {
    const { cached } = await import("./server-cache");
    const state = await cached("signal-filters", 10 * 60_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return parseFilters(await setting(supabaseAdmin, FILTERS_KEY));
    });
    const m = state.markets[market] ?? {};
    return new Set(LEARNED_FILTERS.filter((f) => m[f]?.relaxed));
  } catch {
    return new Set();
  }
}

/** What's learned, for the Boss's report. */
export async function filtersState(admin: Admin): Promise<FiltersState> {
  try {
    return parseFilters(await setting(admin, FILTERS_KEY));
  } catch {
    return { v: 1, markets: {} };
  }
}

/**
 * Studies every filter for both markets when a study is due. Called by the
 * minute watcher when it had nothing to send. Says what changed. Never throws.
 */
export async function maybeStudyFilters(admin: Admin, now = Date.now()): Promise<string> {
  try {
    const last = Date.parse((await setting(admin, RUN_KEY)) ?? "");
    if (Number.isFinite(last) && now - last < FILTER_STUDY_MS) return "not due";
    await save(admin, RUN_KEY, new Date(now).toISOString());
    const since = new Date(now - DAYS * 86_400_000).toISOString();
    const [shadows, live] = await Promise.all([
      admin
        .from("signal_shadows")
        .select("market, reason, outcome, pips, pip")
        .gte("created_at", since)
        .not("outcome", "is", null)
        .limit(20_000),
      admin
        .from("trade_signals")
        .select("market, status, best_target, entry, stop, tp1, pip, direction, feeds")
        .gte("created_at", since)
        .limit(20_000),
    ]);
    if (shadows.error) return "skipped: no shadow table";
    const state = parseFilters(await setting(admin, FILTERS_KEY));
    const changes: string[] = [];
    for (const market of MARKETS) {
      const sh = (
        (shadows.data ?? []) as {
          market: string;
          reason: string;
          outcome: string;
          pips: number | null;
          pip: number | null;
        }[]
      ).filter((r) => r.market === market);
      const lv = (
        (live.data ?? []) as {
          market: string;
          status: string;
          best_target: number;
          entry: number;
          stop: number;
          tp1: number;
          pip: number | null;
          direction: "BUY" | "SELL";
          feeds: { relaxed?: string; bias?: boolean } | null;
        }[]
      ).filter((r) => r.market === market && r.feeds?.relaxed && !r.feeds?.bias);
      const size =
        Number(sh.find((r) => Number(r.pip) > 0)?.pip) ||
        Number(lv.find((r) => Number(r.pip) > 0)?.pip) ||
        1;
      // Vantage's measured cost per trade (spread plus any commission).
      const { costPerTrade } = await import("./broker-quotes.server");
      const cost = await costPerTrade(market, SPREAD_COST[market] ?? 0).catch(
        () => SPREAD_COST[market] ?? 0,
      );
      const spread = cost / size;
      const m = (state.markets[market] ??= {});
      for (const f of LEARNED_FILTERS) {
        const shadowTrades: FilterTrade[] = sh
          .filter((r) => r.reason === f && r.outcome !== "unfilled")
          .map((r) => ({
            outcome: r.outcome as FilterTrade["outcome"],
            pips: Number(r.pips) || 0,
          }));
        const liveTrades: FilterTrade[] = lv.flatMap((r) => {
          if (r.feeds?.relaxed !== f) return [];
          const won = Number(r.best_target) >= 1;
          const lost = r.status === "stopped" && !won;
          if (!won && !lost) return [];
          const side = r.direction === "BUY" ? 1 : -1;
          const unit = Number(r.pip) > 0 ? Number(r.pip) : 1;
          return [
            {
              outcome: won ? ("win" as const) : ("loss" as const),
              pips: ((Number(won ? r.tp1 : r.stop) - Number(r.entry)) * side) / unit,
            },
          ];
        });
        const before = m[f]?.relaxed ?? false;
        m[f] = nextFilterState(m[f], shadowTrades, liveTrades, spread, now);
        if (m[f]!.relaxed !== before)
          changes.push(`${market} ${SHADOW_REASONS[f]}: ${m[f]!.relaxed ? "relaxed" : "back on"}`);
      }
    }
    state.lastRunAt = new Date(now).toISOString();
    await save(admin, FILTERS_KEY, JSON.stringify(state));
    return changes.length ? changes.join("; ") : "no change";
  } catch (e) {
    console.warn("[signals] filter study failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}
