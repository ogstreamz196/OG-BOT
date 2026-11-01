// Extra chart setups beside the engine's trend pullback (buildPlan), read
// from closed entry-frame candles only, so the backtest and live signals see
// the same thing. Each one names a side, a market entry at the last close,
// the risk (entry to the structure that proves it wrong) and three targets in
// that risk's units, like TradePlan.raw, so the members' stop room and take
// profit (Tuning) apply the same way.
//
// None of them is trusted by default: the learning loop backtests each one
// per market (signal-learning.server.ts) and only switches it on for live
// signals once it has earned it, and only when the engine itself has no
// setup (a "wait").
import { adx } from "./trade-signal-extras";
import {
  atr,
  ema,
  scaleTargets,
  type Candle,
  type FrameRead,
  type TradePlan,
  type Tuning,
} from "./trade-signal";

export type SetupId =
  | "breakout_retest"
  | "sweep_reclaim"
  | "range_fade"
  | "wick_rejection"
  | "exhaustion_reversal"
  | "double_top_bottom"
  | "flag_continuation"
  | "fvg_retest";

export const SETUP_IDS: SetupId[] = [
  "breakout_retest",
  "sweep_reclaim",
  "range_fade",
  "wick_rejection",
  "exhaustion_reversal",
  "double_top_bottom",
  "flag_continuation",
  "fvg_retest",
];

/** Classic chart patterns: they need a higher win rate before going live (SETUP_MIN_WIN_RATE). */
export const PATTERN_IDS: SetupId[] = ["double_top_bottom", "flag_continuation", "fvg_retest"];

/** What members see on the card. */
export const SETUP_NAMES: Record<SetupId, string> = {
  breakout_retest: "Breakout & retest",
  sweep_reclaim: "Liquidity sweep & reclaim",
  range_fade: "Range fade",
  wick_rejection: "Wick rejection",
  exhaustion_reversal: "Exhaustion reversal",
  double_top_bottom: "Double top / bottom",
  flag_continuation: "Flag continuation",
  fvg_retest: "Fair value gap retest",
};

export type SetupHit = {
  id: SetupId;
  direction: "BUY" | "SELL";
  /** The last close: a market entry. */
  entry: number;
  risk: number;
  targets: [number, number, number];
  atr: number;
  confidencePct: number;
};

/** Fewest closed candles a setup is read from. */
const MIN_CANDLES = 80;

/**
 * Breakout & retest: price closed through the highest high (lowest low) of
 * the 52 candles before the last 8, came back to that level without falling
 * through it, and the last candle closed away from it in the breakout's
 * direction.
 */
function breakoutRetest(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  const before = cs.slice(-60, -8);
  const recent = cs.slice(-8);
  for (const side of [1, -1] as const) {
    const level =
      side === 1 ? Math.max(...before.map((c) => c.h)) : Math.min(...before.map((c) => c.l));
    const breakAt = recent.findIndex((c) => (c.c - level) * side > a * 0.1);
    if (breakAt < 0 || breakAt >= recent.length - 1) continue;
    const after = recent.slice(breakAt + 1);
    // Back to the level (within 0.3 ATR) but not through it (0.5 ATR).
    const deepest =
      side === 1 ? Math.min(...after.map((c) => c.l)) : Math.max(...after.map((c) => c.h));
    const gap = (deepest - level) * side;
    if (gap > a * 0.3 || gap < -a * 0.5) continue;
    const away = (last.c - level) * side;
    if (away <= 0 || away > a * 1.2 || (last.c - last.o) * side <= 0) continue;
    const risk = clampRisk(Math.abs(last.c - (deepest - side * a * 0.2)), a, 0.6, 2);
    return {
      id: "breakout_retest",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: inR(last.c, side, risk, [1, 2, 3]),
    };
  }
  return null;
}

/**
 * Liquidity sweep & reclaim: one of the last two candles poked past the
 * lowest low (highest high) of the 28 before them by more than 0.1 ATR and
 * closed back inside, and the last close is still back inside.
 */
function sweepReclaim(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  const prior = cs.slice(-30, -2);
  for (const side of [1, -1] as const) {
    // BUY: a sweep of the lows; SELL: a sweep of the highs.
    const level =
      side === 1 ? Math.min(...prior.map((c) => c.l)) : Math.max(...prior.map((c) => c.h));
    const sweep = cs
      .slice(-2)
      .find((c) =>
        side === 1 ? c.l < level - a * 0.1 && c.c > level : c.h > level + a * 0.1 && c.c < level,
      );
    if (!sweep || (last.c - level) * side <= 0) continue;
    const extreme = side === 1 ? sweep.l : sweep.h;
    const risk = clampRisk(Math.abs(last.c - (extreme - side * a * 0.15)), a, 0.5, 2);
    return {
      id: "sweep_reclaim",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: inR(last.c, side, risk, [1, 2, 3]),
    };
  }
  return null;
}

/**
 * Range fade: no trend (ADX under 20), the last 48 candles in a range 2 to 6
 * ATR tall, and the last candle turning back from its bottom (top) 15%,
 * aiming at the middle, then the far side.
 */
function rangeFade(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const trend = adx(cs.slice(-120));
  if (!(trend < 20)) return null;
  const box = cs.slice(-48);
  const top = Math.max(...box.map((c) => c.h));
  const bottom = Math.min(...box.map((c) => c.l));
  const height = top - bottom;
  if (height < a * 2 || height > a * 6) return null;
  const last = cs[cs.length - 1];
  for (const side of [1, -1] as const) {
    const edge = side === 1 ? bottom : top;
    const far = side === 1 ? top : bottom;
    if (Math.abs(last.c - edge) > height * 0.15 || (last.c - last.o) * side <= 0) continue;
    const risk = Math.abs(last.c - (edge - side * a * 0.3));
    const mid = (top + bottom) / 2;
    const t: [number, number, number] = [mid, far - side * height * 0.1, far];
    // The targets have to be in the trade's favour and in order.
    if (!t.every((x, i) => (x - (i ? t[i - 1] : last.c)) * side > 0)) continue;
    return {
      id: "range_fade",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: t,
    };
  }
  return null;
}

/**
 * Wick rejection (a fast scalp): the last closed candle is a big one (at
 * least 0.8 ATR from top to bottom) with a long wick (60%+ of it, twice the
 * body or more) that made the lowest low (highest high) of the last 20
 * candles, and it closed in the other end's 40%: price tested a level and got
 * thrown back. In on the close, the stop just past the wick's tip, quick
 * targets (1, 1.5 and 2 risks).
 */
function wickRejection(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  const range = last.h - last.l;
  if (!(range >= a * 0.8)) return null;
  const body = Math.abs(last.c - last.o);
  const prior = cs.slice(-21, -1);
  for (const side of [1, -1] as const) {
    // BUY: a long lower wick off the lows; SELL: a long upper wick off the highs.
    const wick = side === 1 ? Math.min(last.o, last.c) - last.l : last.h - Math.max(last.o, last.c);
    if (wick < range * 0.6 || wick < body * 2) continue;
    const tip = side === 1 ? last.l : last.h;
    const tested =
      side === 1
        ? tip <= Math.min(...prior.map((c) => c.l))
        : tip >= Math.max(...prior.map((c) => c.h));
    if (!tested) continue;
    const where = side === 1 ? (last.c - last.l) / range : (last.h - last.c) / range;
    if (where < 0.6) continue;
    const risk = clampRisk(Math.abs(last.c - (tip - side * a * 0.1)), a, 0.4, 1.5);
    return {
      id: "wick_rejection",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: inR(last.c, side, risk, [1, 1.5, 2]),
    };
  }
  return null;
}

/**
 * Exhaustion reversal (a fast scalp): four of the five candles before the
 * last ran the same way, price got stretched 2 ATR or more from the 20 EMA,
 * and the last candle went the other way and swallowed the one before it
 * (closed past its open). In on the close, the stop just past the run's
 * extreme, quick targets (1, 1.5 and 2 risks).
 */
function exhaustionReversal(
  cs: Candle[],
  a: number,
): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  const prev = cs[cs.length - 2];
  const run = cs.slice(-6, -1);
  const mean = ema(
    cs.slice(-60).map((c) => c.c),
    20,
  ).at(-2);
  if (mean == null || !Number.isFinite(mean)) return null;
  // side: the way the reversal trades (BUY after a run down).
  for (const side of [1, -1] as const) {
    const against = run.filter((c) => (c.c - c.o) * side < 0).length;
    if (against < 4) continue;
    const stretch = (mean - prev.c) * side;
    if (stretch < a * 2) continue;
    const turns = (last.c - last.o) * side > 0 && (last.c - prev.o) * side > 0;
    if (!turns) continue;
    const extreme =
      side === 1
        ? Math.min(...cs.slice(-3).map((c) => c.l))
        : Math.max(...cs.slice(-3).map((c) => c.h));
    const risk = clampRisk(Math.abs(last.c - (extreme - side * a * 0.1)), a, 0.5, 1.5);
    return {
      id: "exhaustion_reversal",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: inR(last.c, side, risk, [1, 1.5, 2]),
    };
  }
  return null;
}

/** Bars on each side a swing point has to beat to count. */
const WING = 2;

/** Indexes (in `cs`) of swing lows (side 1) or swing highs (side −1). */
function swings(cs: Candle[], side: 1 | -1): number[] {
  const out: number[] = [];
  for (let i = WING; i < cs.length - WING; i++) {
    const v = side === 1 ? cs[i].l : cs[i].h;
    let ok = true;
    for (let k = i - WING; k <= i + WING && ok; k++)
      if (k !== i) ok = side === 1 ? cs[k].l >= v : cs[k].h <= v;
    if (ok) out.push(i);
  }
  return out;
}

/**
 * Double bottom (top) with a neckline break: two swing lows (highs) in the 60
 * candles before the last, at least 10 candles apart and within 0.2 ATR of
 * each other, both the window's bottom (top) within that; the neckline (the
 * highest high between them, lowest low for a top) is at least 0.5 ATR away,
 * and the last candle is the first to close beyond it. The stop goes past
 * the second bottom (top), targets 1, 1.5 and 2 risks.
 */
function doubleTopBottom(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  const prev = cs[cs.length - 2];
  const win = cs.slice(-61, -1);
  for (const side of [1, -1] as const) {
    const lv = (c: Candle) => (side === 1 ? c.l : c.h);
    const extreme = side === 1 ? Math.min(...win.map(lv)) : Math.max(...win.map(lv));
    const pts = swings(win, side).filter((i) => Math.abs(lv(win[i]) - extreme) <= a * 0.2);
    // The latest pair that fits.
    for (let j = pts.length - 1; j > 0; j--) {
      const second = pts[j];
      const first = pts
        .slice(0, j)
        .reverse()
        .find((i) => second - i >= 10);
      if (first == null) continue;
      if (Math.abs(lv(win[first]) - lv(win[second])) > a * 0.2) continue;
      const between = win.slice(first + 1, second);
      if (!between.length) continue;
      const neck =
        side === 1 ? Math.max(...between.map((c) => c.h)) : Math.min(...between.map((c) => c.l));
      if ((neck - extreme) * side < a * 0.5) continue;
      // The first close through the neckline, and nothing since the second
      // bottom has already closed through it.
      if ((last.c - neck) * side <= 0 || (prev.c - neck) * side > 0) continue;
      if (win.slice(second).some((c) => (c.c - neck) * side > 0)) continue;
      const risk = clampRisk(Math.abs(last.c - (lv(win[second]) - side * a * 0.1)), a, 0.5, 2.5);
      return {
        id: "double_top_bottom",
        direction: side === 1 ? "BUY" : "SELL",
        entry: last.c,
        risk,
        targets: inR(last.c, side, risk, [1, 1.5, 2]),
      };
    }
  }
  return null;
}

/**
 * Bull (bear) flag: a pole of 3 to 5 candles moving at least 1.5 ATR, then a
 * tight flag of 5 to 12 candles (no taller than 60% of the pole, giving back
 * at most half of it, never past the pole's high/low), and the last candle
 * closing beyond the flag in the pole's direction. The stop goes past the
 * flag's base, targets 1, 1.5 and 2 risks.
 */
function flagContinuation(cs: Candle[], a: number): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const last = cs[cs.length - 1];
  for (let f = 5; f <= 12; f++) {
    const flag = cs.slice(-1 - f, -1);
    const top = Math.max(...flag.map((c) => c.h));
    const bottom = Math.min(...flag.map((c) => c.l));
    for (let p = 3; p <= 5; p++) {
      const pole = cs.slice(-1 - f - p, -1 - f);
      if (pole.length < p) continue;
      const move = pole[pole.length - 1].c - pole[0].o;
      if (Math.abs(move) < a * 1.5) continue;
      const side: 1 | -1 = move > 0 ? 1 : -1;
      const size = Math.abs(move);
      const poleEnd =
        side === 1 ? Math.max(...pole.map((c) => c.h)) : Math.min(...pole.map((c) => c.l));
      if (top - bottom > size * 0.6) continue;
      // Shallow: gives back at most half the pole, never makes a new extreme.
      const giveBack = side === 1 ? poleEnd - bottom : top - poleEnd;
      if (giveBack > size * 0.5) continue;
      if ((side === 1 ? top - poleEnd : poleEnd - bottom) > a * 0.1) continue;
      // The breakout: the last close beyond the flag, the pole's way.
      const edge = side === 1 ? top : bottom;
      if ((last.c - edge) * side <= 0 || (last.c - last.o) * side <= 0) continue;
      const base = side === 1 ? bottom : top;
      const risk = clampRisk(Math.abs(last.c - (base - side * a * 0.1)), a, 0.4, 2);
      return {
        id: "flag_continuation",
        direction: side === 1 ? "BUY" : "SELL",
        entry: last.c,
        risk,
        targets: inR(last.c, side, risk, [1, 1.5, 2]),
      };
    }
  }
  return null;
}

/**
 * Fair value gap retest, only with the bigger timeframe's trend: a 3-candle
 * imbalance in the 20 candles before the last (bullish: candle 1's high under
 * candle 3's low by 0.2 ATR or more; bearish the other way round) that no
 * close has filled since, and the last candle dipping into the gap and closing
 * back out of it the trend's way. The stop goes past the gap's origin
 * (candle 1's low, high for a bearish gap), targets 1, 1.5 and 2 risks.
 */
function fvgRetest(
  cs: Candle[],
  a: number,
  higher?: FrameRead["bias"],
): Omit<SetupHit, "confidencePct" | "atr"> | null {
  const side: 1 | -1 | 0 = higher === "bullish" ? 1 : higher === "bearish" ? -1 : 0;
  if (!side) return null;
  const last = cs[cs.length - 1];
  const n = cs.length;
  // Newest gap first; candle 3 at least two candles before the last.
  for (let k = n - 4; k >= Math.max(0, n - 22); k--) {
    const c1 = cs[k];
    const c3 = cs[k + 2];
    const lo = side === 1 ? c1.h : c3.h; // gap's far edge (where it'd be filled)
    const hi = side === 1 ? c3.l : c1.l; // gap's near edge (where price comes back in)
    const gap = side === 1 ? c3.l - c1.h : c1.l - c3.h;
    if (gap < a * 0.2) continue;
    // No close has filled it since.
    const after = cs.slice(k + 3, -1);
    if (after.some((c) => (side === 1 ? c.c < lo : c.c > lo))) continue;
    // The last candle taps into it and closes back out, the trend's way.
    const tapped =
      side === 1 ? last.l <= hi && last.l >= lo - a * 0.1 : last.h >= hi && last.h <= lo + a * 0.1;
    if (!tapped || (last.c - hi) * side <= 0 || (last.c - last.o) * side <= 0) continue;
    const origin = side === 1 ? c1.l : c1.h;
    const risk = clampRisk(Math.abs(last.c - (origin - side * a * 0.1)), a, 0.4, 2);
    return {
      id: "fvg_retest",
      direction: side === 1 ? "BUY" : "SELL",
      entry: last.c,
      risk,
      targets: inR(last.c, side, risk, [1, 1.5, 2]),
    };
  }
  return null;
}

const clampRisk = (r: number, a: number, lo: number, hi: number) =>
  Math.min(Math.max(r, a * lo), a * hi);

const inR = (entry: number, side: 1 | -1, risk: number, rs: number[]) =>
  rs.map((r) => entry + side * risk * r) as [number, number, number];

/**
 * Every setup showing on these closed candles. `higher` is the bigger
 * timeframe's read: siding with it adds confidence, fighting it takes some off.
 */
export function findSetups(candles: Candle[], higher?: FrameRead["bias"]): SetupHit[] {
  if (candles.length < MIN_CANDLES) return [];
  const a = atr(candles.slice(-50), 14);
  if (!Number.isFinite(a) || a <= 0) return [];
  const hits = [
    breakoutRetest(candles, a),
    sweepReclaim(candles, a),
    rangeFade(candles, a),
    wickRejection(candles, a),
    exhaustionReversal(candles, a),
    doubleTopBottom(candles, a),
    flagContinuation(candles, a),
    fvgRetest(candles, a, higher),
  ];
  return hits
    .filter((h): h is NonNullable<typeof h> => !!h && h.risk > 0)
    .map((h) => {
      const withTrend =
        higher === (h.direction === "BUY" ? "bullish" : "bearish")
          ? 10
          : higher === (h.direction === "BUY" ? "bearish" : "bullish")
            ? -8
            : 0;
      return { ...h, atr: a, confidencePct: Math.min(85, Math.max(55, 62 + withTrend)) };
    });
}

/**
 * A live plan from an extra setup, in place of the engine's "wait": a market
 * entry at the price now, the members' stop room and target pull-in (Tuning)
 * on the setup's own risk and targets. Null when price has already run more
 * than half the risk away from the setup's close.
 */
export function setupPlan(
  plan: TradePlan,
  hit: SetupHit,
  priceNow: number,
  tune: Tuning,
): TradePlan | null {
  const side = hit.direction === "BUY" ? 1 : -1;
  const entry = Number.isFinite(priceNow) && priceNow > 0 ? priceNow : hit.entry;
  const shift = entry - hit.entry;
  if (Math.abs(shift) > hit.risk * 0.5) return null;
  const raw = hit.targets.map((t) => t + shift) as [number, number, number];
  const stop = entry - side * hit.risk * tune.stopRoom;
  const targets = scaleTargets(hit.direction, entry, raw, hit.atr * 0.05, tune.scale);
  const stopDistance = hit.risk * tune.stopRoom;
  const r = (t: number) => (Math.abs(t - entry) / stopDistance).toFixed(1).replace(/\.0$/, "");
  const pct = hit.confidencePct;
  return {
    ...plan,
    direction: hit.direction,
    entry,
    entryType: "market",
    entryNote: `Market price now (${SETUP_NAMES[hit.id]})`,
    stop,
    targets,
    rr: `1:${r(targets[0])} / 1:${r(targets[1])} / 1:${r(targets[2])}`,
    confidencePct: pct,
    confidence: pct >= 75 ? "High" : pct >= 62 ? "Medium" : "Low",
    quality: "Clean",
    qualityNote: undefined,
    caution: undefined,
    // The engine's "no clean trend" notes don't apply to this setup.
    cautions: plan.cautions.filter((c) => c !== plan.qualityNote && c !== plan.caution),
    verdict: "trade",
    waitReason: undefined,
    setup: SETUP_NAMES[hit.id],
  };
}
