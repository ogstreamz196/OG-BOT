// Random signals (the Boss's ask): every so often OG B0T gives a signal on
// its own, the way it answers a member's request, using a strategy picked at
// random, to find out which works best. Gold and bitcoin only.
//
// The strategies: the chart engine on its own, the AI desk (every AI reading
// the chart together, the request style; inside the desk's daily budget), and
// each extra setup and chart pattern (trade-setups.ts), proven or not. Each
// random signal keeps its strategy (feeds.strategy) and is followed like any
// other; the picker leans towards what's been working (strategyScore) and
// keeps trying the rest now and then, so the mix tweaks itself as results
// come in. A strategy that has lost money over RANDOM_MIN_TRADES or more is
// picked much less often.
import { SETUP_IDS, SETUP_NAMES, type SetupId } from "./trade-setups";

type Admin = any;

export type Strategy = "engine" | "desk" | SetupId;

export const STRATEGIES: Strategy[] = ["engine", "desk", ...SETUP_IDS];

export const STRATEGY_NAMES: Record<Strategy, string> = {
  engine: "Chart engine",
  desk: "AI desk",
  ...SETUP_NAMES,
};

/** How often a random signal is due: somewhere between these (minutes). */
export const RANDOM_EVERY_MIN = [30, 90] as const;
/** The lowest confidence a random signal is posted at (a request-style read, but never a coin toss). */
export const RANDOM_MIN_CONFIDENCE = 60;
/** Trades a strategy needs before its losses count against it. */
export const RANDOM_MIN_TRADES = 12;
/** site_content: when the next random signal is due. */
export const RANDOM_NEXT_KEY = "signals.random.nextAt";

export type StrategyStats = { n: number; wins: number; losses: number; sumR: number };

/**
 * How keen to be on a strategy: its win rate so far (starting from an even
 * 1 in 2), plus a random nudge that's bigger the fewer trades it has, so new
 * ones get tried. One that has lost money over RANDOM_MIN_TRADES or more is
 * marked well down. Pure (given `rand`).
 */
export function strategyScore(s: StrategyStats | undefined, rand: () => number): number {
  const n = s?.n ?? 0;
  const mean = ((s?.wins ?? 0) + 1) / ((s?.wins ?? 0) + (s?.losses ?? 0) + 2);
  const nudge = (rand() - 0.5) / Math.sqrt(n + 1);
  const losing = n >= RANDOM_MIN_TRADES && (s?.sumR ?? 0) < 0;
  return (mean + nudge) * (losing ? 0.3 : 1);
}

/** The strategy to try now. Pure (given `rand`). */
export function pickStrategy(
  stats: Partial<Record<Strategy, StrategyStats>>,
  rand: () => number,
  allowed: Strategy[] = STRATEGIES,
): Strategy {
  let best = allowed[0];
  let top = -Infinity;
  for (const s of allowed) {
    const v = strategyScore(stats[s], rand);
    if (v > top) ((top = v), (best = s));
  }
  return best;
}

/** The ask that builds a strategy's signal ("XAUUSD signal 5m setup:flag_continuation"). */
export function strategyAsk(base: string, s: Strategy): string {
  return s === "engine" || s === "desk" ? base : `${base} setup:${s}`;
}

/** The card's timeframe line tagged with the strategy: "⏱ 5M · 💪 66% · 🎲 Flag continuation". */
export function tagStrategy(card: string, s: Strategy): string {
  return card
    .split("\n")
    .map((l) => (l.startsWith("⏱") ? `${l} · 🎲 ${STRATEGY_NAMES[s]}` : l))
    .join("\n");
}

/**
 * Each strategy's record from its random signals over the last 60 days
 * (read only; results in risks, resultInRisks). Never throws.
 */
export async function strategyStats(
  admin: Admin,
  now = Date.now(),
): Promise<Partial<Record<Strategy, StrategyStats>>> {
  try {
    const { resultInRisks } = await import("./paper-account.server");
    const { data } = await admin
      .from("trade_signals")
      .select("direction, entry, stop, tp1, status, best_target, feeds")
      .eq("sender_worker", "trade")
      .not("feeds->>strategy", "is", null)
      .not("status", "in", "(pending,open,tp1,tp2)")
      .gte("created_at", new Date(now - 60 * 86_400_000).toISOString())
      .limit(5000);
    const out: Partial<Record<Strategy, StrategyStats>> = {};
    for (const r of (data ?? []) as (Parameters<typeof resultInRisks>[0] & {
      feeds: { strategy?: string } | null;
    })[]) {
      const s = r.feeds?.strategy as Strategy | undefined;
      if (!s || !STRATEGIES.includes(s)) continue;
      const res = resultInRisks(r);
      if (res == null) continue;
      const t = (out[s] ??= { n: 0, wins: 0, losses: 0, sumR: 0 });
      t.n++;
      t.sumR += res;
      if (res > 0) t.wins++;
      else if (res < 0) t.losses++;
    }
    return out;
  } catch {
    return {};
  }
}

/** One line per strategy for the Boss: "Flag continuation: 7 of 11 won (+2.4R)". */
export function strategyLines(stats: Partial<Record<Strategy, StrategyStats>>): string[] {
  return STRATEGIES.filter((s) => stats[s]?.n).map((s) => {
    const x = stats[s]!;
    const sign = x.sumR >= 0 ? "+" : "−";
    return `${STRATEGY_NAMES[s]}: ${x.wins} of ${x.wins + x.losses} won (${sign}${Math.abs(x.sumR).toFixed(1)}R)`;
  });
}
