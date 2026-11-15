// The HFT lab (the Boss, 2026-11-15: "super HFT, trades opening instantly and
// closing in 10-15 seconds, several at once, try multiple strategies until we
// find the one with most wins in a row, keep a record per strategy").
//
// Pure and browser-safe. Every minute the server replays the last few minutes
// of 1-second candles through a set of micro strategies at several hold times
// and keeps a scorecard per market, strategy and hold: wins, losses, money
// after the spread (in spreads), and win/loss streaks. Nothing here trades or
// posts: it only measures, so a strategy can be promoted once it has proved
// itself on live prices with the broker's real costs.
//
// What the research said before this was built (24h + an unseen 24h of
// Binance 1-second data, Vantage costs: gold 0.35, bitcoin 15): every
// strategy lost after the spread at 10-15 seconds (median 15-second move on
// bitcoin is about one spread), and only gold's breakout / trend pullback
// held 2-5 minutes stayed positive on the unseen day (+0.1 to +0.2 spreads a
// trade). So the lab keeps 15 seconds in the race but also scores 1, 2 and 5
// minutes, and counts one trade per strategy at a time (overlapping trades on
// the same move made fake 70-win "streaks").

export type Sec = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  tb?: number;
};

export const MICRO_STRATEGIES = [
  "breakout_60s",
  "fade_breakout_60s",
  "trend_pullback",
  "trend_momentum",
  "momentum_5s",
  "fade_5s",
  "ema_cross",
  "volume_burst",
  "random",
] as const;
export type MicroStrategy = (typeof MICRO_STRATEGIES)[number];

export const MICRO_LABEL: Record<MicroStrategy, string> = {
  breakout_60s: "Breakout of the last minute",
  fade_breakout_60s: "Fade the breakout (the opposite)",
  trend_pullback: "Trend pullback",
  trend_momentum: "Trend momentum",
  momentum_5s: "5-second burst",
  fade_5s: "Fade the 5-second burst (the opposite)",
  ema_cross: "Fast average cross",
  volume_burst: "Volume burst (buyers vs sellers)",
  random: "Coin flip (the yardstick)",
};

/** Hold times in seconds, each with its take profit / stop in spreads (null: time exit only). */
export const MICRO_HOLDS = [15, 60, 120, 300] as const;
export type MicroHold = (typeof MICRO_HOLDS)[number];
export const MICRO_EXITS: Record<MicroHold, { tp: number; sl: number }> = {
  15: { tp: 2, sl: 1 },
  60: { tp: 2, sl: 1 },
  120: { tp: 4, sl: 2 },
  300: { tp: 4, sl: 2 },
};

/** Seconds of history before a signal counts (the 300-second average needs it). */
export const WARMUP = 600;

export type MicroStats = {
  n: number;
  wins: number;
  losses: number;
  /** Sum of results, in spreads, after paying the spread on every trade. */
  spreads: number;
  /** Positive: wins in a row now; negative: losses in a row now. */
  streak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  /** No new trade for this strategy and hold until this time (one at a time). */
  busyUntil: number;
  /** The last 50 results in spreads, newest last (for "lately"). */
  recent: number[];
};

export type MicroMarketState = {
  /** Per hold: trades opened up to this time are already scored. */
  done: Partial<Record<MicroHold, number>>;
  stats: Record<string, MicroStats>;
};

export type MicroLabState = { v: 1; markets: Record<string, MicroMarketState>; updatedAt?: number };

export const keyOf = (s: MicroStrategy, h: MicroHold) => `${s}@${h}`;

export const emptyStats = (): MicroStats => ({
  n: 0,
  wins: 0,
  losses: 0,
  spreads: 0,
  streak: 0,
  bestWinStreak: 0,
  worstLossStreak: 0,
  busyUntil: 0,
  recent: [],
});

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A stored lab state, repaired: unknown keys dropped, numbers made safe. Pure. */
export function cleanLab(raw: unknown): MicroLabState {
  const src = (raw ?? {}) as { markets?: Record<string, unknown>; updatedAt?: unknown };
  const out: MicroLabState = { v: 1, markets: {}, updatedAt: num(src.updatedAt) || undefined };
  for (const [m, mv] of Object.entries(src.markets ?? {})) {
    if (!/^[A-Z]{3,10}$/.test(m)) continue;
    const ms = (mv ?? {}) as { done?: Record<string, unknown>; stats?: Record<string, unknown> };
    const market: MicroMarketState = { done: {}, stats: {} };
    for (const h of MICRO_HOLDS) {
      const d = num(ms.done?.[String(h)]);
      if (d) market.done[h] = d;
    }
    for (const s of MICRO_STRATEGIES)
      for (const h of MICRO_HOLDS) {
        const k = keyOf(s, h);
        const r = ms.stats?.[k] as Partial<MicroStats> | undefined;
        if (!r) continue;
        market.stats[k] = {
          n: num(r.n),
          wins: num(r.wins),
          losses: num(r.losses),
          spreads: num(r.spreads),
          streak: num(r.streak),
          bestWinStreak: num(r.bestWinStreak),
          worstLossStreak: num(r.worstLossStreak),
          busyUntil: num(r.busyUntil),
          recent: Array.isArray(r.recent)
            ? r.recent.filter((x) => Number.isFinite(x)).slice(-50)
            : [],
        };
      }
    out.markets[m] = market;
  }
  return out;
}

function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = new Array<number>(xs.length);
  let prev = xs[0] ?? 0;
  for (let i = 0; i < xs.length; i++) {
    prev = i === 0 ? xs[0] : prev + k * (xs[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** A fixed pseudo-random number per second, so a replay always flips the same coins. */
function coin(t: number): number {
  let x = Math.floor(t / 1000) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Each strategy's call at each second: 1 buy, -1 sell, 0 nothing. Pure.
 * Same rules as the research script, so live results can be compared with it.
 */
export function microSignals(secs: Sec[]): Record<MicroStrategy, Int8Array> {
  const n = secs.length;
  const c = secs.map((s) => s.c);
  const out = Object.fromEntries(MICRO_STRATEGIES.map((s) => [s, new Int8Array(n)])) as Record<
    MicroStrategy,
    Int8Array
  >;
  if (n < 2) return out;
  const e5 = ema(c, 5),
    e20 = ema(c, 20),
    e60 = ema(c, 60),
    e300 = ema(c, 300);
  // Average 1-second move over the last minute, and average volume.
  const step = c.map((x, i) => (i ? Math.abs(x - c[i - 1]) : 0));
  const vol = secs.map((s) => s.v ?? 0);
  let sumStep = 0,
    sumVol = 0;
  for (let i = 0; i < n; i++) {
    sumStep += step[i];
    sumVol += vol[i];
    if (i >= 60) {
      sumStep -= step[i - 60];
      sumVol -= vol[i - 60];
    }
    if (i < 60) continue;
    const vol60 = sumStep / 60 + 1e-9;
    const vm = sumVol / 60 + 1e-12;
    const r5 = c[i] - c[i - 5];
    const r20 = c[i] - c[i - 20];
    let hi = -Infinity,
      lo = Infinity;
    for (let j = i - 60; j < i; j++) {
      if (secs[j].h > hi) hi = secs[j].h;
      if (secs[j].l < lo) lo = secs[j].l;
    }
    const mom = r5 > 3 * vol60 ? 1 : r5 < -3 * vol60 ? -1 : 0;
    out.momentum_5s[i] = mom;
    out.fade_5s[i] = -mom;
    const brk = c[i] > hi ? 1 : c[i] < lo ? -1 : 0;
    out.breakout_60s[i] = brk;
    out.fade_breakout_60s[i] = -brk;
    out.ema_cross[i] =
      e5[i] > e20[i] && e5[i - 1] <= e20[i - 1]
        ? 1
        : e5[i] < e20[i] && e5[i - 1] >= e20[i - 1]
          ? -1
          : 0;
    const buyShare = vol[i] > 0 ? (secs[i].tb ?? vol[i] / 2) / vol[i] : 0.5;
    out.volume_burst[i] =
      vol[i] > 4 * vm && buyShare > 0.7 ? 1 : vol[i] > 4 * vm && buyShare < 0.3 ? -1 : 0;
    out.trend_pullback[i] =
      c[i] > e300[i] && r20 < -2 * vol60 && r5 > 0
        ? 1
        : c[i] < e300[i] && r20 > 2 * vol60 && r5 < 0
          ? -1
          : 0;
    out.trend_momentum[i] =
      c[i] > e300[i] && e20[i] > e60[i] && r5 > 2 * vol60
        ? 1
        : c[i] < e300[i] && e20[i] < e60[i] && r5 < -2 * vol60
          ? -1
          : 0;
    const f = coin(secs[i].t);
    out.random[i] = f < 0.01 ? (coin(secs[i].t + 7) < 0.5 ? 1 : -1) : 0;
  }
  return out;
}

/**
 * One trade's result in spreads, opened at second i's close in direction d:
 * a buy pays the ask and sells at the bid (so the spread is paid once), the
 * stop is checked before the take profit inside a second (the cautious way),
 * and whatever is open at the hold time closes there. Null when the candles
 * don't reach the hold time yet. Pure.
 */
export function tradeResult(
  secs: Sec[],
  i: number,
  d: 1 | -1,
  hold: MicroHold,
  cost: number,
): number | null {
  const last = i + hold;
  if (last >= secs.length || cost <= 0) return null;
  const { tp, sl } = MICRO_EXITS[hold];
  const e = secs[i].c;
  for (let j = i + 1; j <= last; j++) {
    const fav = d > 0 ? secs[j].h - e : e - secs[j].l;
    const adv = d > 0 ? e - secs[j].l : secs[j].h - e;
    if (adv >= sl * cost - cost / 2) return -sl;
    if (fav >= tp * cost + cost / 2) return tp;
  }
  return (d * (secs[last].c - e) - cost) / cost;
}

function record(s: MicroStats, res: number): void {
  s.n++;
  s.spreads = Math.round((s.spreads + res) * 1000) / 1000;
  if (res > 0) {
    s.wins++;
    s.streak = s.streak > 0 ? s.streak + 1 : 1;
    s.bestWinStreak = Math.max(s.bestWinStreak, s.streak);
  } else {
    s.losses++;
    s.streak = s.streak < 0 ? s.streak - 1 : -1;
    s.worstLossStreak = Math.max(s.worstLossStreak, -s.streak);
  }
  s.recent = [...s.recent, Math.round(res * 100) / 100].slice(-50);
}

/**
 * Score every new trade in this window of 1-second candles into the market's
 * state (changed in place): for each hold, trades opened after `done[hold]`
 * whose hold has fully played out, one at a time per strategy. Returns how
 * many trades were scored. Pure apart from the state it updates.
 */
export function scoreWindow(state: MicroMarketState, secs: Sec[], cost: number): number {
  if (secs.length <= WARMUP || cost <= 0) return 0;
  const sig = microSignals(secs);
  let scored = 0;
  for (const hold of MICRO_HOLDS) {
    const from = Math.max(state.done[hold] ?? 0, secs[WARMUP].t - 1);
    const lastOpen = secs.length - 1 - hold;
    let doneTo = state.done[hold] ?? 0;
    for (let i = WARMUP; i <= lastOpen; i++) {
      const t = secs[i].t;
      if (t <= from) continue;
      doneTo = t;
      for (const s of MICRO_STRATEGIES) {
        const d = sig[s][i];
        if (!d) continue;
        const k = keyOf(s, hold);
        const st = (state.stats[k] ??= emptyStats());
        if (t < st.busyUntil) continue;
        const res = tradeResult(secs, i, d as 1 | -1, hold, cost);
        if (res == null) continue;
        record(st, res);
        st.busyUntil = t + hold * 1000;
        scored++;
      }
    }
    if (doneTo) state.done[hold] = doneTo;
  }
  return scored;
}

/** Trades needed before a strategy can be called proven. */
export const PROVEN_MIN_TRADES = 300;

export type MicroRow = {
  strategy: MicroStrategy;
  hold: MicroHold;
  label: string;
  n: number;
  winRate: number;
  /** Average result per trade, in spreads, after the spread. */
  perTrade: number;
  /** The last 50 trades' average, in spreads. */
  lately: number;
  streak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  proven: boolean;
};

/**
 * The market's scorecard, best first (money after the spread per trade, not
 * win rate or streaks: a long streak of tiny wins can still lose money).
 * "Proven" needs PROVEN_MIN_TRADES trades, money made after the spread, to
 * beat the coin flip at the same hold, and its last 50 trades not losing
 * (150 trades flipped on luck in testing: bitcoin's 5-minute breakout passed
 * one day and failed the next). Pure.
 */
export function microBoard(state: MicroMarketState | undefined): MicroRow[] {
  if (!state) return [];
  const rows: MicroRow[] = [];
  for (const s of MICRO_STRATEGIES)
    for (const h of MICRO_HOLDS) {
      const st = state.stats[keyOf(s, h)];
      if (!st?.n) continue;
      const perTrade = st.spreads / st.n;
      const coinFlip = state.stats[keyOf("random", h)];
      const coinPer = coinFlip?.n ? coinFlip.spreads / coinFlip.n : -Infinity;
      rows.push({
        strategy: s,
        hold: h,
        label: MICRO_LABEL[s],
        n: st.n,
        winRate: Math.round((1000 * st.wins) / st.n) / 10,
        perTrade: Math.round(perTrade * 100) / 100,
        lately: st.recent.length
          ? Math.round((st.recent.reduce((a, b) => a + b, 0) / st.recent.length) * 100) / 100
          : 0,
        streak: st.streak,
        bestWinStreak: st.bestWinStreak,
        worstLossStreak: st.worstLossStreak,
        proven:
          s !== "random" &&
          st.n >= PROVEN_MIN_TRADES &&
          perTrade > 0 &&
          perTrade > coinPer &&
          st.recent.reduce((a, b) => a + b, 0) >= 0,
      });
    }
  return rows.sort((a, b) => b.perTrade - a.perTrade || b.n - a.n);
}
