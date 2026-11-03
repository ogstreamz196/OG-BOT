// Random signals (the Boss's ask): every so often OG B0T gives a signal on
// its own, the way it answers a member's request, using a strategy picked at
// random, to find out which works best. Bitcoin only (gold is retired).
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
import { SIGNAL_MARKETS } from "./signal-markets";

type Admin = any;

export type Strategy = "engine" | "desk" | SetupId;

export const STRATEGIES: Strategy[] = ["engine", "desk", ...SETUP_IDS];

export const STRATEGY_NAMES: Record<Strategy, string> = {
  engine: "Chart engine",
  desk: "AI desk",
  ...SETUP_NAMES,
};

/** How often a random signal is due: somewhere between these (minutes). Free: no AI unless the desk is picked. */
export const RANDOM_EVERY_MIN = [4, 12] as const;
/** The charts a random signal can be read on; the picker leans towards the ones winning. */
export const RANDOM_FRAMES = ["1m", "5m", "15m", "1h"] as const;
export type RandomFrame = (typeof RANDOM_FRAMES)[number];
/**
 * A quick signal (1m, 5m, 15m) is skipped when the 1-hour chart reads the
 * other way at this confidence or more: trading with the bigger trend wins
 * more often. Free (one more chart read, no AI).
 */
export const HOUR_AGAINST_CONFIDENCE = 60;
/** The lowest confidence a random signal is posted at (a request-style read, but never a coin toss). */
export const RANDOM_MIN_CONFIDENCE = 60;
/** Trades a strategy needs before its losses count against it. */
export const RANDOM_MIN_TRADES = 12;
/** site_content: when the next random signal is due. */
export const RANDOM_NEXT_KEY = "signals.random.nextAt";

export type StrategyStats = {
  n: number;
  wins: number;
  losses: number;
  sumR: number;
  /** The demo account's dollars on this strategy's trades (those it took). */
  cash?: number;
};

/** A finished trade-bot signal, as strategyStats reads it. */
export type StrategyRow = {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  best_target: number;
  feeds: Record<string, unknown> | null;
};

/**
 * Each strategy's record from finished signals: trades, wins, losses and
 * result in risks (resultInRisks), plus the demo's dollars where it took the
 * trade. Bias-only rows and ones that never filled don't count. Pure.
 */
export function tallyStrategies(
  rows: StrategyRow[],
  inRisks: (r: StrategyRow) => number | null,
): Partial<Record<Strategy, StrategyStats>> {
  const out: Partial<Record<Strategy, StrategyStats>> = {};
  for (const r of rows) {
    if (r.feeds?.bias) continue;
    const res = inRisks(r);
    if (res == null) continue;
    const t = (out[strategyOf(r.feeds)] ??= { n: 0, wins: 0, losses: 0, sumR: 0, cash: 0 });
    t.n++;
    t.sumR += res;
    if (res > 0) t.wins++;
    else if (res < 0) t.losses++;
    const pnl = Number((r.feeds?.paper as { pnl?: unknown } | undefined)?.pnl);
    if (Number.isFinite(pnl)) t.cash = Math.round(((t.cash ?? 0) + pnl) * 100) / 100;
  }
  return out;
}

/**
 * How keen to be on a strategy: what it has actually made per trade, in
 * risks (not its win rate: with take profits under the stop's distance a
 * strategy can win more than half its trades and still lose money), pulled
 * towards 0 while it has few trades (as if it had 3 flat ones more), plus a
 * random nudge that's bigger the fewer trades it has, so new ones get tried.
 * One that has lost money over RANDOM_MIN_TRADES or more is marked well down.
 * Pure (given `rand`).
 */
export function strategyScore(s: StrategyStats | undefined, rand: () => number): number {
  const n = s?.n ?? 0;
  const sumR = s?.sumR ?? 0;
  const mean = sumR / (n + 3);
  const nudge = ((rand() - 0.5) * 0.8) / Math.sqrt(n + 1);
  const losing = n >= RANDOM_MIN_TRADES && sumR < 0;
  return mean + nudge - (losing ? 0.5 : 0);
}

/**
 * Which strategy a trade-bot signal was: a random signal says so itself
 * (feeds.strategy); a scanner alert names its setup when one stood in for the
 * engine (feeds.setup, by its card name); a desk-scout post was every AI
 * agreeing (feeds.desk "unanimous"); anything else is the chart engine. So the
 * picker learns from every signal the bot gives, not only its random ones.
 * Pure.
 */
export function strategyOf(feeds: Record<string, unknown> | null | undefined): Strategy {
  const own = feeds?.strategy;
  if (typeof own === "string" && (STRATEGIES as string[]).includes(own)) return own as Strategy;
  const setup = feeds?.setup;
  if (typeof setup === "string") {
    const id = SETUP_IDS.find((k) => SETUP_NAMES[k] === setup);
    if (id) return id;
  }
  if (feeds?.desk === "unanimous") return "desk";
  return "engine";
}

/** The option scoring best now (strategyScore). Pure (given `rand`). */
function pickBest<K extends string>(
  allowed: readonly K[],
  stats: Partial<Record<K, StrategyStats>>,
  rand: () => number,
): K {
  let best = allowed[0];
  let top = -Infinity;
  for (const s of allowed) {
    const v = strategyScore(stats[s], rand);
    if (v > top) ((top = v), (best = s));
  }
  return best;
}

/** The strategy to try now. Pure (given `rand`). */
export function pickStrategy(
  stats: Partial<Record<Strategy, StrategyStats>>,
  rand: () => number,
  allowed: Strategy[] = STRATEGIES,
): Strategy {
  return pickBest(allowed, stats, rand);
}

/** The chart to read now, leaning towards the ones making money, same as strategies. Pure (given `rand`). */
export function pickFrame(
  stats: Partial<Record<RandomFrame, StrategyStats>>,
  rand: () => number,
): RandomFrame {
  return pickBest(RANDOM_FRAMES, stats, rand);
}

/** Each chart's record (stored timeframes are "5M", "1H"), from the same rows as tallyStrategies. Pure. */
export function tallyFrames(
  rows: (StrategyRow & { timeframe?: string | null })[],
  inRisks: (r: StrategyRow) => number | null,
): Partial<Record<RandomFrame, StrategyStats>> {
  const out: Partial<Record<RandomFrame, StrategyStats>> = {};
  for (const r of rows) {
    const f = String(r.timeframe ?? "").toLowerCase() as RandomFrame;
    if (!RANDOM_FRAMES.includes(f) || r.feeds?.bias) continue;
    const res = inRisks(r);
    if (res == null) continue;
    const t = (out[f] ??= { n: 0, wins: 0, losses: 0, sumR: 0 });
    t.n++;
    t.sumR += res;
    if (res > 0) t.wins++;
    else if (res < 0) t.losses++;
  }
  return out;
}

/**
 * Whether a quick signal goes against the 1-hour chart: the hour reads the
 * other side at HOUR_AGAINST_CONFIDENCE or more. Pure.
 */
export function againstTheHour(
  frame: RandomFrame,
  direction: "BUY" | "SELL",
  hour: { direction: "BUY" | "SELL"; confidencePct: number } | undefined,
): boolean {
  if (frame === "1h" || !hour) return false;
  return hour.direction !== direction && hour.confidencePct >= HOUR_AGAINST_CONFIDENCE;
}

/** The ask that builds a strategy's signal ("BTCUSD signal 5m setup:flag_continuation"). */
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
 * Each strategy's record from every signal the trade bot gave on the markets
 * it still trades over the last `days` (60 for the picker; strategyOf; read only; results in
 * risks, resultInRisks). Never throws.
 */
export async function signalStats(
  admin: Admin,
  now = Date.now(),
  days = 60,
): Promise<{
  strategies: Partial<Record<Strategy, StrategyStats>>;
  frames: Partial<Record<RandomFrame, StrategyStats>>;
}> {
  try {
    const { resultInRisks } = await import("./paper-account.server");
    const { data } = await admin
      .from("trade_signals")
      .select("direction, entry, stop, tp1, status, best_target, feeds, timeframe")
      .eq("sender_worker", "trade")
      .in("market", [...SIGNAL_MARKETS])
      .not("status", "in", "(pending,open,tp1,tp2)")
      .gte("created_at", new Date(now - days * 86_400_000).toISOString())
      .limit(5000);
    const rows = (data ?? []) as (StrategyRow & { timeframe?: string | null })[];
    const inR = (r: StrategyRow) => resultInRisks(r as Parameters<typeof resultInRisks>[0]);
    return { strategies: tallyStrategies(rows, inR), frames: tallyFrames(rows, inR) };
  } catch {
    return { strategies: {}, frames: {} };
  }
}

/** Each strategy's record (signalStats). Never throws. */
export async function strategyStats(
  admin: Admin,
  now = Date.now(),
  days = 60,
): Promise<Partial<Record<Strategy, StrategyStats>>> {
  return (await signalStats(admin, now, days)).strategies;
}

/** One line per strategy for the Boss: "Flag continuation: 7 of 11 won (+2.4R)". */
export function strategyLines(stats: Partial<Record<Strategy, StrategyStats>>): string[] {
  return STRATEGIES.filter((s) => stats[s]?.n).map((s) => {
    const x = stats[s]!;
    const sign = x.sumR >= 0 ? "+" : "−";
    return `${STRATEGY_NAMES[s]}: ${x.wins} of ${x.wins + x.losses} won (${sign}${Math.abs(x.sumR).toFixed(1)}R)`;
  });
}
