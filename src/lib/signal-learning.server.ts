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
import type { LearnSample } from "./trade-signal-backtest";
import {
  advanceTimed,
  brokerLevels,
  targetsReached,
  type SignalStatus,
  type TimeLimits,
} from "./trade-signal-outcome";
import { SETUP_IDS, SETUP_NAMES, type SetupId } from "./trade-setups";
import {
  DEFAULT_TUNING,
  NO_TIME_LIMIT,
  detectTradeIntent,
  scaleTargets,
  SESSIONS,
  ukSession,
  type SessionId,
  type Tuning,
} from "./trade-signal";

type Admin = any;

export const LEARNING_KEY = "signals.learning";
const RUN_KEY = "signals.learning.lastRun";
/** One market per run, so each is studied about every 2 hours. */
export const LEARN_EVERY_MS = 3600_000;
/** The days a study covers when no history is kept (see signal-samples). */
const LEARN_DAYS = 14;
/** Fewer filled trades than this and a setting can't be judged. */
export const MIN_TRADES = 20;
const HISTORY = 12;

/**
 * What one trade costs at a typical broker (spread plus a little slippage), in
 * price: gold about 35 cents an ounce, bitcoin about $15. Learning takes it off
 * every filled trade, so settings that only win small don't look better than
 * they bank.
 */
export const SPREAD_COST: Record<string, number> = { XAUUSD: 0.35, BTCUSD: 15 };

/** The markets it studies: gold through PAX Gold, as live gold signals are. */
export const LEARN_MARKETS = [
  { code: "XAUUSD", symbol: "PAXGUSDT", futures: "XAUUSDT", ask: "XAUUSD signal 5m" },
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
  pullback: [0, 1],
  minVol: [0, 0.8],
  holdFor: [10, 60],
  fillWithin: [5, 60],
  /** 0 (off) or in this range. */
  beAt: [0.5, 1.5],
  runner: [1.5, 3],
} as const;

/** A switchable setting: off (0) below most of its range's start, else inside it on `step`s. */
const switchable = (v: number, [lo, hi]: readonly [number, number], step: number) =>
  !(v >= lo * 0.75) ? 0 : Math.round(clamp(v, [lo, hi]) / step) * step;

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
  /** How each extra chart setup did, and whether it's earned live use. */
  setups?: Partial<Record<SetupId, SetupStats>>;
  /**
   * A setting of its own for each trading session with enough trades to learn
   * from (see learnSessions); the others use the market's.
   */
  sessions?: Partial<Record<SessionId, SessionLearning>>;
  history: {
    at: string;
    tuning: Tuning;
    winRate: number;
    avgR: number;
    n: number;
    kept: boolean;
  }[];
};

export type SessionLearning = {
  tuning: Tuning;
  /** Filled trades in that session over the period studied, and how they did. */
  n: number;
  winRate: number;
  avgR: number;
  lesson: string;
};

export type LearningState = { v: 1; markets: Record<string, MarketLearning> };

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Keeps a setting inside the safe bounds, on tidy steps. */
export function safeTuning(t: Partial<Tuning>): Tuning {
  // Settings saved before a field existed get the hand-set value for it.
  const d = DEFAULT_TUNING;
  const v = <K extends keyof Tuning>(k: K): Tuning[K] => (t[k] ?? d[k]) as Tuning[K];
  t = {
    stopRoom: v("stopRoom"),
    scale: v("scale"),
    minConfidence: v("minConfidence"),
    pullback: v("pullback"),
    minVol: v("minVol"),
    skipBlocks: v("skipBlocks"),
    holdFor: v("holdFor"),
    fillWithin: v("fillWithin"),
    beAt: v("beAt"),
    runner: v("runner"),
    entryStyle: v("entryStyle"),
  };
  return {
    entryStyle: [0, 1, 2, 3].includes(Math.round(Number(t.entryStyle)))
      ? Math.round(Number(t.entryStyle))
      : 0,
    beAt: switchable(Number(t.beAt), BOUNDS.beAt, 0.25),
    runner: switchable(Number(t.runner), BOUNDS.runner, 0.25),
    // Whole 5 minutes, so one candle's noise can't move them.
    holdFor: Math.round(clamp(t.holdFor!, BOUNDS.holdFor) / 5) * 5,
    fillWithin: Math.round(clamp(t.fillWithin!, BOUNDS.fillWithin) / 5) * 5,
    pullback: Number(round(clamp(t.pullback!, BOUNDS.pullback), 0.05).toFixed(2)),
    stopRoom: Number(round(clamp(t.stopRoom!, BOUNDS.stopRoom), 0.05).toFixed(2)),
    scale: [0, 1, 2].map((i) =>
      Number(round(clamp(t.scale![i], BOUNDS.scale[i]), 0.05).toFixed(2)),
    ) as Tuning["scale"],
    minConfidence: Math.round(clamp(t.minConfidence!, BOUNDS.minConfidence)),
    minVol: Number(round(clamp(t.minVol!, BOUNDS.minVol), 0.05).toFixed(2)),
    // At most two whole UK time blocks (0–5) sat out.
    skipBlocks: [...new Set((t.skipBlocks ?? []).map(Math.round))]
      .filter((b) => b >= 0 && b <= 5)
      .sort((a, b) => a - b)
      .slice(0, 2),
  };
}

/** The three tracked levels: all on the take profit, or a third there and the rest to the runner. */
export function exitTargets(entry: number, tp: number, runner: number): [number, number, number] {
  if (!runner) return [tp, tp, tp];
  const run = entry + (tp - entry) * runner;
  return [tp, run, run];
}

/**
 * The entry, stop and take profit a past setup gets under a setting. A
 * pullback entry moves with the pullback depth, and the whole plan (the
 * engine's risk and targets) moves with it.
 */
/** A setting's time limits for a setup sent at `t` (none at NO_TIME_LIMIT). */
export function timeLimits(tune: Tuning, t: number): TimeLimits {
  return {
    ...(tune.fillWithin < NO_TIME_LIMIT ? { fillBy: t + tune.fillWithin * 60_000 } : {}),
    ...(tune.holdFor < NO_TIME_LIMIT ? { holdMs: tune.holdFor * 60_000 } : {}),
  };
}

export function applyTuning(s: LearnSample, tune: Tuning) {
  const side = s.direction === "BUY" ? 1 : -1;
  const pull = s.raw.pull;
  const alt = s.raw.alt;
  const style = alt ? tune.entryStyle : 0;
  // The engine's own entry (a pullback moves with the learned depth), or the
  // learned entry style on the same setup: pullback, break or now.
  let entry = pull ? pull.price + (pull.mean - pull.price) * tune.pullback : s.entry;
  let type: LearnSample["entryType"] = s.entryType;
  if (alt && style === 1) {
    entry = alt.price + (alt.mean - alt.price) * tune.pullback;
    type = "limit";
  } else if (alt && style === 2) {
    entry = alt.breakAt;
    type = "stop";
  } else if (alt && style === 3) {
    entry = alt.price;
    type = "market";
  }
  const shift = entry - s.entry;
  const raw = s.raw.targets.map((t) => t + shift) as [number, number, number];
  const stop = entry - side * s.raw.risk * tune.stopRoom;
  // One take profit (the Quick Scalp), as live signals have; with a runner,
  // a third there and the rest further on.
  const tp = scaleTargets(s.direction, entry, raw, s.raw.atr * 0.05, tune.scale)[0];
  return {
    entry,
    type,
    stop,
    targets: exitTargets(entry, tp, tune.runner),
    ...(tune.beAt ? { beTrigger: entry + side * Math.abs(entry - stop) * tune.beAt } : {}),
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
    // Too quiet, or a time of day it sits out (unknown readings never filter).
    if (s.raw.vol != null && s.raw.vol < tune.minVol) continue;
    if (s.raw.block != null && tune.skipBlocks.includes(s.raw.block)) continue;
    const { entry, type, stop, targets, beTrigger } = applyTuning(s, tune);
    // With the setting's time limits: the entry's to fill in time, and a trade
    // that's gone nowhere is closed on time.
    const market = type === "market";
    // Hit the way the broker hits them: a buy fills on the ask and closes on
    // the bid, half the spread either side of these mid-price candles.
    const half = (s.cost ?? 0) / 2;
    const res = advanceTimed(
      brokerLevels(
        {
          direction: s.direction,
          entryType: type === "stop" ? "stop" : "limit",
          entry,
          stop,
          targets,
          status: market ? "open" : "pending",
          expiresAt: s.expiresAt,
          ...(market ? { enteredAt: s.t } : {}),
          ...(beTrigger != null ? { beTrigger } : {}),
        },
        half,
      ),
      s.path,
      s.expiresAt,
      timeLimits(tune, s.t),
    );
    const filledAt = market ? s.t : res.events.find((e) => e.kind === "filled")?.at;
    const entered = filledAt != null;
    if (!entered) continue;
    const best = Math.max(0, ...res.events.map((e) => targetsReached(e.kind as SignalStatus)));
    const side = s.direction === "BUY" ? 1 : -1;
    const inR = (px: number) => ((px - entry) * side) / s.raw.risk;
    let r = 0;
    if (res.status === "stopped") r = inR(stop);
    else {
      for (let k = 0; k < best; k++) r += inR(targets[k]) / 3;
      if (res.status === "expired" || res.status === "cancelled") {
        // Out at the last price before it was closed (on time, or at the end).
        const hold = timeLimits(tune, s.t).holdMs;
        const until =
          hold && filledAt != null ? Math.min(s.expiresAt, filledAt + hold) : s.expiresAt;
        // Closed at the bid (a buy) or the ask (a sell), not the mid.
        const lastMid = s.path.filter((c) => c.t < until).at(-1)?.c;
        const last = lastMid != null ? lastMid - side * half : undefined;
        const floor = best >= 1 ? 0 : inR(stop);
        r += ((3 - best) / 3) * Math.max(floor, last != null ? inR(last) : 0);
      }
    }
    // A market entry pays the ask (a buy) or the bid (a sell), half a spread
    // off the mid it was priced at; every filled trade pays any commission.
    if (market) r -= half / s.raw.risk;
    r -= (s.fee ?? 0) / s.raw.risk;
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
        pullback: nudge(current.pullback, 0.25),
        minVol: nudge(current.minVol, 0.15),
        skipBlocks: current.skipBlocks,
        holdFor: nudge(current.holdFor, 15),
        fillWithin: nudge(current.fillWithin, 15),
        // Exits: nudged when on, and now and then switched on or off.
        beAt: rand() < 0.25 ? (current.beAt ? 0 : 0.5 + rand()) : nudge(current.beAt, 0.25),
        runner:
          rand() < 0.25 ? (current.runner ? 0 : 1.5 + rand() * 1.5) : nudge(current.runner, 0.4),
        // Now and then another way in.
        entryStyle: rand() < 0.2 ? Math.floor(rand() * 4) : current.entryStyle,
      }),
    );
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const r2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`;
const describe = (t: Tuning) =>
  `stop room ${t.stopRoom.toFixed(2)}×, targets pulled to ${t.scale.map(pct).join("/")}, ` +
  `trading from ${t.minConfidence}% confidence, pullback entries ${pct(t.pullback)} of the way back to the 20 EMA` +
  (t.minVol > 0 ? `, only when the chart is at least ${pct(t.minVol)} as lively as normal` : "") +
  (t.skipBlocks.length ? `, sitting out ${t.skipBlocks.map(blockName).join(" and ")} UK` : "") +
  (t.holdFor < NO_TIME_LIMIT
    ? `, closing a trade that's gone nowhere after ${t.holdFor} minutes`
    : "") +
  (t.fillWithin < NO_TIME_LIMIT
    ? `, cancelling an entry not filled within ${t.fillWithin} minutes`
    : "") +
  (t.entryStyle
    ? `, entering ${["", "on a pullback", "on a break", "at the price now"][t.entryStyle]} every time`
    : "") +
  (t.beAt ? `, stop to entry once it's ${t.beAt}× the risk in profit` : "") +
  (t.runner
    ? `, banking a third at the take profit and running the rest to ${t.runner}× its distance`
    : "");

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
  days: number = LEARN_DAYS,
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
      pullback: (now.pullback + best.pullback) / 2,
      minVol: (now.minVol + best.minVol) / 2,
      skipBlocks: now.skipBlocks,
      holdFor: (now.holdFor + best.holdFor) / 2,
      fillWithin: (now.fillWithin + best.fillWithin) / 2,
      // Switching an exit on or off can't be done halfway: the better one's.
      beAt: !now.beAt !== !best.beAt ? best.beAt : (now.beAt + best.beAt) / 2,
      runner: !now.runner !== !best.runner ? best.runner : (now.runner + best.runner) / 2,
      // A way in can't be blended either.
      entryStyle: best.entryStyle,
    });
    // Halfway when that's enough; the full step only when halfway isn't.
    if (heldUp && score(evaluate(sorted, blended)) > score(before)) next = blended;
    else if (heldUp && score(evaluate(sorted, best)) > score(before)) next = best;
  }
  // The hours that keep losing under that setting are sat out.
  const skip = losingBlocks(sorted, next);
  if (skip.join() !== next.skipBlocks.join()) next = { ...next, skipBlocks: skip };
  const kept = next !== now;
  const after = evaluate(sorted, next);
  const lesson = kept
    ? `${label}: over the last ${days} days, ${describe(next)} won ${pct(after.winRate)} of ${after.n} trades (avg ${r2(after.avgR)}), up from ${pct(before.winRate)} (avg ${r2(before.avgR)}) with the old setting, so I've switched to it.`
    : before.n >= MIN_TRADES
      ? `${label}: over the last ${days} days, my setting (${describe(now)}) won ${pct(before.winRate)} of ${before.n} trades (avg ${r2(before.avgR)}); nothing I tried did reliably better, so I'm keeping it.`
      : `${label}: only ${before.n} trades in the last ${days} days, too few to learn from; keeping my setting.`;
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
/** The setting live signals use: the session's own if it has one, else the market's. */
export async function learnedTuning(market: string, at = Date.now()): Promise<Tuning> {
  const m = (await learningState()).markets[market];
  const t = m?.sessions?.[ukSession(at)]?.tuning ?? m?.tuning;
  return t ? safeTuning(t) : DEFAULT_TUNING;
}

/**
 * A setting per trading session: each session's past setups studied on their
 * own (the same rules: beat the current setting on the first 70%, hold up on
 * the rest, move halfway). A session needs MIN_TRADES filled trades under its
 * starting setting or it isn't given one (it uses the market's). The live
 * confidence floor still applies. Pure, so it can be tested.
 */
export function learnSessions(
  samples: LearnSample[],
  market: Tuning,
  had: Partial<Record<SessionId, SessionLearning>>,
  rand: () => number,
  label: string,
  days: number,
  floor: number | null,
): Partial<Record<SessionId, SessionLearning>> {
  const out: Partial<Record<SessionId, SessionLearning>> = {};
  for (const s of SESSIONS) {
    const mine = samples.filter((x) => ukSession(x.t) === s.id);
    const start = had[s.id]?.tuning ? safeTuning(had[s.id]!.tuning) : market;
    if (evaluate(mine, start).n < MIN_TRADES) continue;
    const res = learnFromSamples(mine, start, rand, `${label} (${s.name})`, days);
    const tuning = safeTuning({
      ...res.next,
      minConfidence: Math.max(res.next.minConfidence, floor ?? 0),
    });
    const after = evaluate(mine, tuning);
    out[s.id] = {
      tuning,
      n: after.n,
      winRate: after.winRate,
      avgR: after.avgR,
      lesson: res.lesson,
    };
  }
  return out;
}

/** One line on the sessions' records, for the lesson. */
function sessionLesson(sessions: Partial<Record<SessionId, SessionLearning>>): string {
  const parts = SESSIONS.flatMap((s) => {
    const x = sessions[s.id];
    return x
      ? [`${s.name} ${Math.round(x.winRate * 100)}% of ${x.n} (avg ${x.avgR.toFixed(2)})`]
      : [];
  });
  return parts.length ? `By session, after spread: ${parts.join(", ")}.` : "";
}

/** The extra setups that have earned live use for a market. */
export async function liveSetups(market: string): Promise<SetupId[]> {
  const stats = (await learningState()).markets[market]?.setups ?? {};
  return SETUP_IDS.filter((id) => stats[id]?.live);
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
    // The kept history, topped up with what's new (and a week further back
    // each time until it reaches 90 days): see signal-samples.server.ts.
    const { gatherSamples } = await import("./signal-samples.server");
    const { samples, days, added } = await gatherSamples(admin, market, inst, now, fetcher);
    // Every trade pays the spread.
    // Vantage's own spread for each setup's hour of the week (measured), else
    // the hand-set typical one; plus any commission (Raw/Pro ECN accounts).
    const bq = await import("./broker-quotes.server");
    const model = await bq.spreadModel();
    const fee = await bq.commissionPrice(market.code);
    const fallback = SPREAD_COST[market.code] ?? 0;
    for (const s of samples) {
      s.cost = bq.typicalSpread(model, market.code, s.t) ?? fallback;
      s.fee = fee;
    }
    const had = state.markets[market.code];
    const label = market.code === "XAUUSD" ? "Gold" : "Bitcoin";
    const studied = learnFromSamples(
      samples,
      had?.tuning ?? DEFAULT_TUNING,
      seeded(now),
      label,
      days || LEARN_DAYS,
    );
    // What really happened beats any replay: a confidence band that's been
    // losing live raises the floor (never lowers it).
    const live = await liveResults(admin, market.code, now);
    const floor = liveFloor(live);
    const out =
      floor != null && floor > studied.next.minConfidence
        ? {
            ...studied,
            next: safeTuning({ ...studied.next, minConfidence: floor }),
            kept: true,
            lesson: `${studied.lesson} Live results: setups under ${Math.min(floor, BOUNDS.minConfidence[1])}% lost more than they won, so I only trade from there now.`,
          }
        : studied;
    const at = new Date(now).toISOString();
    const setups = evaluateSetups(samples, out.next);
    // Each session (Asia, London, New York, evening) with enough trades gets a
    // setting of its own, never below the live confidence floor.
    const sessions = learnSessions(
      samples,
      out.next,
      had?.sessions ?? {},
      seeded(now + 1),
      label,
      days || LEARN_DAYS,
      floor,
    );
    state.markets[market.code] = {
      tuning: out.next,
      runs: (had?.runs ?? 0) + 1,
      lastRunAt: at,
      lastChangeAt: out.kept ? at : had?.lastChangeAt,
      current: out.after,
      lesson: `${out.lesson} ${setupLesson(setups)} ${sessionLesson(sessions)}`
        .replace(/\s+/g, " ")
        .trim(),
      setups,
      sessions,
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
    return `${label}: ${out.kept ? "learned a better setting" : "kept its setting"} (${samples.length} setups over ${days} days, ${added} new, ${out.after.n} trades)`;
  } catch (e) {
    console.warn("[signals] learning failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/** A live signal's confidence and how it ended (signal-record buckets). */
export type LiveResult = { confidence_pct: number; status: string; best_target: number };

/** Confidence bands checked against live results, lowest first. */
const LIVE_BANDS: [number, number][] = [
  [51, 59],
  [60, 69],
  [70, 74],
  [75, 79],
];
/** Settled trades a band needs before its live record counts. */
export const LIVE_MIN_DECIDED = 6;

/**
 * The lowest confidence worth trading by live results, or null: working up
 * from the bottom, a band with at least LIVE_MIN_DECIDED settled trades that
 * won under 40% of them lifts the floor above it; the first band that's
 * doing fine stops the climb. Pure, so it can be tested.
 */
export function liveFloor(rows: LiveResult[]): number | null {
  let floor: number | null = null;
  for (const [lo, hi] of LIVE_BANDS) {
    const band = rows.filter((r) => r.confidence_pct >= lo && r.confidence_pct <= hi);
    const won = band.filter((r) => Number(r.best_target) >= 1).length;
    const lost = band.filter((r) => r.status === "stopped" && !(Number(r.best_target) >= 1)).length;
    if (won + lost < LIVE_MIN_DECIDED) continue;
    if (won / (won + lost) < 0.4) floor = hi + 1;
    else break;
  }
  return floor;
}

/** The last 30 days of live signals for a market (not market-bias calls). */
async function liveResults(admin: Admin, market: string, now: number): Promise<LiveResult[]> {
  try {
    const { data, error } = await admin
      .from("trade_signals")
      .select("confidence_pct, status, best_target, feeds")
      .eq("market", market)
      .gte("created_at", new Date(now - 30 * 86_400_000).toISOString())
      .limit(2000);
    if (error) return [];
    return ((data ?? []) as (LiveResult & { feeds?: { bias?: boolean } | null })[]).filter(
      (r) => !r.feeds?.bias,
    );
  } catch {
    return [];
  }
}

/** How an extra setup did in a study. */
export type SetupStats = Evaluation & { live: boolean };

/** Trades a setup needs in a study before it can go live. */
export const SETUP_MIN_TRADES = 12;

/**
 * Each extra setup (trade-setups.ts) followed exactly like a signal under the
 * market's setting (market entry, the stop room, the one take profit). A
 * setup goes live with at least SETUP_MIN_TRADES trades, winning at least
 * half and making money on average; it drops out again if it stops.
 */
export function evaluateSetups(
  samples: LearnSample[],
  tune: Tuning,
): Partial<Record<SetupId, SetupStats>> {
  const out: Partial<Record<SetupId, SetupStats>> = {};
  for (const id of SETUP_IDS) {
    const asSamples: LearnSample[] = samples.flatMap((s) =>
      (s.setups ?? [])
        .filter((h) => h.id === id)
        .map((h) => ({
          t: s.t,
          direction: h.direction,
          entry: h.entry,
          entryType: "market" as const,
          confidencePct: h.confidencePct,
          verdict: "trade" as const,
          raw: { risk: h.risk, targets: h.targets, atr: h.atr },
          path: s.path,
          expiresAt: s.expiresAt,
          cost: s.cost,
        })),
    );
    if (!asSamples.length) continue;
    const e = evaluate(asSamples, { ...tune, minConfidence: 0 });
    out[id] = {
      ...e,
      live: e.n >= SETUP_MIN_TRADES && e.winRate >= 0.5 && e.avgR > 0,
    };
  }
  return out;
}

/** One sentence on the extra setups, for the lesson. */
function setupLesson(stats: Partial<Record<SetupId, SetupStats>>): string {
  const parts = SETUP_IDS.filter((id) => stats[id]).map((id) => {
    const s = stats[id]!;
    return `${SETUP_NAMES[id]} won ${Math.round(s.winRate * 100)}% of ${s.n} (${s.live ? "live" : "not live"})`;
  });
  return parts.length ? `Extra setups: ${parts.join("; ")}.` : "";
}

const blockName = (b: number) =>
  `${String(b * 4).padStart(2, "0")}:00–${String(b * 4 + 4).padStart(2, "0")}:00`;

/** Trades a UK time block needs in a study before it can be sat out. */
export const BLOCK_MIN_TRADES = 10;

/**
 * The UK time blocks (ukBlock) to sit out under a setting: each with at
 * least BLOCK_MIN_TRADES trades, winning under 40% and losing on average,
 * worst first, at most two, and only when sitting them out beats trading
 * them over the whole study.
 */
export function losingBlocks(samples: LearnSample[], tune: Tuning): number[] {
  const all = { ...tune, skipBlocks: [] };
  const bad = [0, 1, 2, 3, 4, 5]
    .map((b) => ({
      b,
      e: evaluate(
        samples.filter((s) => s.raw.block === b),
        all,
      ),
    }))
    .filter(({ e }) => e.n >= BLOCK_MIN_TRADES && e.winRate < 0.4 && e.avgR < 0)
    .sort((x, y) => x.e.sumR - y.e.sumR)
    .slice(0, 2)
    .map(({ b }) => b)
    .sort((a, b) => a - b);
  if (!bad.length) return [];
  return evaluate(samples, { ...all, skipBlocks: bad }).sumR > evaluate(samples, all).sumR
    ? bad
    : [];
}
