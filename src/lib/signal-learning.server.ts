// OG B0T learning from its own signals. Whenever the minute watcher isn't
// busy (no updates to send that minute), at most every LEARN_EVERY_MS, it
// takes one market (gold or bitcoin, whichever was studied longest ago),
// replays the last LEARN_DAYS of 5-minute setups (the same engine, the
// tracker's own rules) and tries other settings for what it controls:
// how much room the stop gets, how far each target is pulled in, and the
// lowest confidence worth trading (Tuning in trade-signal.ts).
//
// A new setting is only kept when it beats the current one on the first 70%
// of the period AND isn't worse on the last 30% it never saw (so it isn't
// just fitting noise), and then it only moves halfway there, inside fixed
// safe bounds. Every run writes a plain lesson, which live signals and the
// AI desk read. Everything lives in site_content "signals.learning".
import {
  collectSamples,
  fetchBinanceHistory,
  historyNeeded,
  type LearnSample,
} from "./trade-signal-backtest";
import { advanceSignal, targetsReached, type SignalStatus } from "./trade-signal-outcome";
import {
  DEFAULT_TUNING,
  detectTradeIntent,
  scaleTargets,
  type CandleSets,
  type Tuning,
} from "./trade-signal";

type Admin = any;

export const LEARNING_KEY = "signals.learning";
const RUN_KEY = "signals.learning.lastRun";
/** One market per run, so each is studied about every 4 hours. */
export const LEARN_EVERY_MS = 2 * 3600_000;
const LEARN_DAYS = 7;
/** A setup every 30 minutes of the period. */
const SAMPLE_STEP = 6;
/** Fewer filled trades than this and a setting can't be judged. */
export const MIN_TRADES = 20;
const HISTORY = 12;

/** The markets it studies: gold through PAX Gold, as live gold signals are. */
export const LEARN_MARKETS = [
  { code: "XAUUSD", symbol: "PAXGUSDT", ask: "XAUUSD signal 5m" },
  { code: "BTCUSD", symbol: "BTCUSDT", ask: "BTCUSD signal 5m" },
] as const;

/** The safe range for every setting it can learn. */
export const BOUNDS = {
  stopRoom: [1.0, 1.6],
  scale: [
    [0.6, 0.95],
    [0.4, 0.8],
    [0.6, 0.95],
  ],
  minConfidence: [51, 80],
} as const;

export type Evaluation = {
  /** Filled trades. */
  n: number;
  wins: number;
  losses: number;
  /** Result in the engine's own risk units (the same unit whatever the stop room). */
  sumR: number;
  winRate: number;
  avgR: number;
};

export type MarketLearning = {
  tuning: Tuning;
  runs: number;
  lastRunAt: string;
  lastChangeAt?: string;
  /** How the current setting did over the last period studied. */
  current?: Evaluation;
  lesson?: string;
  history: {
    at: string;
    tuning: Tuning;
    winRate: number;
    avgR: number;
    n: number;
    kept: boolean;
  }[];
};

export type LearningState = { v: 1; markets: Record<string, MarketLearning> };

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Keeps a setting inside the safe bounds, on tidy steps. */
export function safeTuning(t: Tuning): Tuning {
  return {
    stopRoom: Number(round(clamp(t.stopRoom, BOUNDS.stopRoom), 0.05).toFixed(2)),
    scale: [0, 1, 2].map((i) =>
      Number(round(clamp(t.scale[i], BOUNDS.scale[i]), 0.05).toFixed(2)),
    ) as Tuning["scale"],
    minConfidence: Math.round(clamp(t.minConfidence, BOUNDS.minConfidence)),
  };
}

/** The stop and targets a past setup gets under a setting. */
export function applyTuning(s: LearnSample, tune: Tuning) {
  const side = s.direction === "BUY" ? 1 : -1;
  return {
    stop: s.entry - side * s.raw.risk * tune.stopRoom,
    targets: scaleTargets(s.direction, s.entry, s.raw.targets, s.raw.atr * 0.05, tune.scale),
  };
}

/**
 * How a setting would have done on past setups, followed with the tracker's
 * rules: a third off at each target, the stop to entry after the first,
 * the stop counting first when a candle touches both.
 */
export function evaluate(samples: LearnSample[], tune: Tuning): Evaluation {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let sumR = 0;
  for (const s of samples) {
    if (s.verdict !== "trade" || s.confidencePct < tune.minConfidence || !(s.raw.risk > 0))
      continue;
    const { stop, targets } = applyTuning(s, tune);
    const res = advanceSignal(
      {
        direction: s.direction,
        entryType: s.entryType === "stop" ? "stop" : "limit",
        entry: s.entry,
        stop,
        targets,
        status: s.entryType === "market" ? "open" : "pending",
        expiresAt: s.expiresAt,
      },
      s.path,
      s.expiresAt,
    );
    const entered = s.entryType === "market" || res.events.some((e) => e.kind === "filled");
    if (!entered) continue;
    const best = Math.max(0, ...res.events.map((e) => targetsReached(e.kind as SignalStatus)));
    const side = s.direction === "BUY" ? 1 : -1;
    const inR = (px: number) => ((px - s.entry) * side) / s.raw.risk;
    let r = 0;
    if (res.status === "stopped") r = inR(stop);
    else {
      for (let k = 0; k < best; k++) r += inR(targets[k]) / 3;
      if (res.status === "expired" || res.status === "cancelled") {
        const last = s.path.at(-1)?.c;
        const floor = best >= 1 ? 0 : inR(stop);
        r += ((3 - best) / 3) * Math.max(floor, last != null ? inR(last) : 0);
      }
    }
    n++;
    sumR += r;
    if (best >= 1) wins++;
    else if (res.status === "stopped") losses++;
  }
  const decided = wins + losses;
  return {
    n,
    wins,
    losses,
    sumR,
    winRate: decided ? wins / decided : 0,
    avgR: n ? sumR / n : 0,
  };
}

const score = (e: Evaluation) => (e.n >= MIN_TRADES ? e.sumR : -Infinity);

/** A small seeded random number source, so a run can be repeated exactly. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Settings to try: the current one nudged every way, plus the hand-set rules. */
export function candidates(current: Tuning, rand: () => number, count = 32): Tuning[] {
  const nudge = (v: number, size: number) => v + (rand() * 2 - 1) * size;
  const out: Tuning[] = [safeTuning(DEFAULT_TUNING)];
  for (let i = 0; i < count; i++)
    out.push(
      safeTuning({
        stopRoom: nudge(current.stopRoom, 0.2),
        scale: [
          nudge(current.scale[0], 0.12),
          nudge(current.scale[1], 0.12),
          nudge(current.scale[2], 0.12),
        ],
        minConfidence: nudge(current.minConfidence, 8),
      }),
    );
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const r2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`;
const describe = (t: Tuning) =>
  `stop room ${t.stopRoom.toFixed(2)}×, targets pulled to ${t.scale.map(pct).join("/")}, ` +
  `trading from ${t.minConfidence}% confidence`;

/**
 * One study of past setups: keeps the current setting unless another one
 * beats it on the first 70% of the period and holds up on the last 30%,
 * and then only moves halfway there. Pure, so it can be tested.
 */
export function learnFromSamples(
  samples: LearnSample[],
  current: Tuning,
  rand: () => number,
  label: string,
): { next: Tuning; kept: boolean; before: Evaluation; after: Evaluation; lesson: string } {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  const now = safeTuning(current);
  const before = evaluate(sorted, now);
  const curTrain = score(evaluate(train, now));
  let best = now;
  let bestScore = curTrain;
  for (const c of candidates(now, rand)) {
    const sc = score(evaluate(train, c));
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }
  const margin = Number.isFinite(curTrain) ? Math.max(0.5, Math.abs(curTrain) * 0.05) : 0;
  let next = now;
  if (best !== now && bestScore > curTrain + margin) {
    const heldUp = evaluate(test, best).sumR >= evaluate(test, now).sumR;
    // Halfway there, so one week can't swing the strategy.
    const blended = safeTuning({
      stopRoom: (now.stopRoom + best.stopRoom) / 2,
      scale: [0, 1, 2].map((i) => (now.scale[i] + best.scale[i]) / 2) as Tuning["scale"],
      minConfidence: (now.minConfidence + best.minConfidence) / 2,
    });
    // Halfway when that's enough; the full step only when halfway isn't.
    if (heldUp && score(evaluate(sorted, blended)) > score(before)) next = blended;
    else if (heldUp && score(evaluate(sorted, best)) > score(before)) next = best;
  }
  const kept = next !== now;
  const after = evaluate(sorted, next);
  const lesson = kept
    ? `${label}: over the last ${LEARN_DAYS} days, ${describe(next)} won ${pct(after.winRate)} of ${after.n} trades (avg ${r2(after.avgR)}), up from ${pct(before.winRate)} (avg ${r2(before.avgR)}) with the old setting, so I've switched to it.`
    : before.n >= MIN_TRADES
      ? `${label}: over the last ${LEARN_DAYS} days, my setting (${describe(now)}) won ${pct(before.winRate)} of ${before.n} trades (avg ${r2(before.avgR)}); nothing I tried did reliably better, so I'm keeping it.`
      : `${label}: only ${before.n} trades in the last ${LEARN_DAYS} days, too few to learn from; keeping my setting.`;
  return { next, kept, before, after, lesson };
}

export function parseLearning(value: string | null | undefined): LearningState {
  try {
    const v = JSON.parse(value ?? "") as LearningState;
    if (v?.v === 1 && v.markets && typeof v.markets === "object") return v;
  } catch {
    // fall through
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

/** What's been learned so far (cached 5 minutes), never throwing. */
export async function learningState(): Promise<LearningState> {
  try {
    const { cached } = await import("./server-cache");
    return await cached("signal-learning", 300_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return parseLearning(await setting(supabaseAdmin, LEARNING_KEY));
    });
  } catch {
    return { v: 1, markets: {} };
  }
}

/** The learned setting for a market, or the hand-set rules. */
export async function learnedTuning(market: string): Promise<Tuning> {
  const t = (await learningState()).markets[market]?.tuning;
  return t ? safeTuning(t) : DEFAULT_TUNING;
}

/** The latest lesson for a market, for the AI desk to read. */
export async function learnedLesson(market: string): Promise<string | null> {
  return (await learningState()).markets[market]?.lesson ?? null;
}

/**
 * Studies one market when a study is due. Called by the minute watcher only
 * when it had nothing to send. Says what happened. Never throws.
 */
export async function maybeLearn(
  admin: Admin,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    const last = Date.parse((await setting(admin, RUN_KEY)) ?? "");
    if (Number.isFinite(last) && now - last < LEARN_EVERY_MS) return "not due";
    // Claim the slot first, so two runs at once can't both study.
    await save(admin, RUN_KEY, new Date(now).toISOString());
    const state = parseLearning(await setting(admin, LEARNING_KEY));
    const market = [...LEARN_MARKETS].sort(
      (a, b) =>
        (Date.parse(state.markets[a.code]?.lastRunAt ?? "") || 0) -
        (Date.parse(state.markets[b.code]?.lastRunAt ?? "") || 0),
    )[0];
    const inst = detectTradeIntent(market.ask) ?? undefined;
    const { start, need } = historyNeeded("5M", LEARN_DAYS, now);
    const sets: CandleSets = { daily: [], hourly: [], fifteen: [], five: [], minute: [] };
    for (const [key, from] of Object.entries(need) as [keyof CandleSets, number][])
      sets[key] = await fetchBinanceHistory(market.symbol, key, from, now, fetcher);
    const samples = collectSamples({
      sets,
      frame: "5M",
      from: start,
      to: now,
      inst,
      step: SAMPLE_STEP,
    });
    const had = state.markets[market.code];
    const label = market.code === "XAUUSD" ? "Gold" : "Bitcoin";
    const out = learnFromSamples(samples, had?.tuning ?? DEFAULT_TUNING, seeded(now), label);
    const at = new Date(now).toISOString();
    state.markets[market.code] = {
      tuning: out.next,
      runs: (had?.runs ?? 0) + 1,
      lastRunAt: at,
      lastChangeAt: out.kept ? at : had?.lastChangeAt,
      current: out.after,
      lesson: out.lesson,
      history: [
        ...(had?.history ?? []),
        {
          at,
          tuning: out.next,
          winRate: out.after.winRate,
          avgR: out.after.avgR,
          n: out.after.n,
          kept: out.kept,
        },
      ].slice(-HISTORY),
    };
    await save(admin, LEARNING_KEY, JSON.stringify(state));
    return `${label}: ${out.kept ? "learned a better setting" : "kept its setting"} (${samples.length} setups, ${out.after.n} trades)`;
  } catch (e) {
    console.warn("[signals] learning failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}
