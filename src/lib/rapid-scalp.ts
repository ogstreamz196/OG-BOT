// Rapid fire in the HFT lab (the Boss, 2026-11-17: "make HFT do 2 trades
// every 3-5 seconds, no open trade limit, it closes when it profits small
// amounts"). Pure and browser-safe.
//
// The lab tries the Boss's plan exactly, on live 1-second prices at Vantage's
// cost, before any of it touches the copier or the signals group: every 3 to
// 5 seconds it opens two trades the way the last 3 seconds moved, with no
// limit on how many are open, each closing at a small profit (its take
// profit), at its stop, or when its time is up. Like the rest of the lab, a
// trade opens ENTRY_DELAY seconds after its signal and pays the spread: a buy
// fills at the ask and closes at the bid, so it starts one spread down.
// Nothing here posts, copies or trades.

import { ENTRY_DELAY, type Sec } from "./micro-scalp";

export type RapidVariant = {
  id: string;
  label: string;
  /** Take profit, in spreads after the spread (0.5 = half a spread made). */
  tp: number;
  /** Stop, in spreads after the spread. */
  sl: number;
  /** Seconds before a trade still open is closed at the price then. */
  maxHold: number;
  /** Direction by coin flip: the yardstick a real edge has to beat. */
  coin?: boolean;
};

export const RAPID_VARIANTS: readonly RapidVariant[] = [
  { id: "small", label: "Small profit (½ spread), stop 3, 1 min max", tp: 0.5, sl: 3, maxHold: 60 },
  { id: "one", label: "One spread profit, stop 3, 1 min max", tp: 1, sl: 3, maxHold: 60 },
  {
    id: "patient",
    label: "Small profit (½ spread), wide stop 6, 5 min max",
    tp: 0.5,
    sl: 6,
    maxHold: 300,
  },
  {
    id: "coin",
    label: "Coin flip, ½ spread, stop 3 (the yardstick)",
    tp: 0.5,
    sl: 3,
    maxHold: 60,
    coin: true,
  },
];

/** Trades opened at each entry (the Boss's "2 trades"). */
export const RAPID_PER_ENTRY = 2;
/** Seconds between entries: 3, 4 or 5, picked per entry. */
export const RAPID_GAP = [3, 5] as const;
const LONGEST = Math.max(...RAPID_VARIANTS.map((v) => v.maxHold));
const WARMUP = 30;

/** Each market's units per 0.01 lot at Vantage: 1 oz of gold, 0.01 BTC. */
export const UNITS_PER_MICRO_LOT: Record<string, number> = { XAUUSD: 1, BTCUSD: 0.01 };

export type RapidStats = {
  n: number;
  wins: number;
  losses: number;
  /** Sum of results in spreads, after the spread. */
  spreads: number;
  /** Sum of results in dollars at 0.01 lot a trade. */
  dollars: number;
  streak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  /** Most trades open at once. */
  peakOpen: number;
  /** When the trades still open close (for counting how many are open). */
  openEnds: number[];
  recent: number[];
};

export type RapidMarket = {
  /** Entries up to this time are already scored. */
  done: number;
  /** The next entry is due at or after this time. */
  next: number;
  stats: Record<string, RapidStats>;
};
export type RapidLab = { v: 1; markets: Record<string, RapidMarket>; updatedAt?: number };

const emptyStats = (): RapidStats => ({
  n: 0,
  wins: 0,
  losses: 0,
  spreads: 0,
  dollars: 0,
  streak: 0,
  bestWinStreak: 0,
  worstLossStreak: 0,
  peakOpen: 0,
  openEnds: [],
  recent: [],
});

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A stored rapid lab, repaired. Pure. */
export function cleanRapid(raw: unknown): RapidLab {
  const src = (raw ?? {}) as { markets?: Record<string, unknown>; updatedAt?: unknown };
  const out: RapidLab = { v: 1, markets: {}, updatedAt: num(src.updatedAt) || undefined };
  for (const [m, mv] of Object.entries(src.markets ?? {})) {
    if (!/^[A-Z]{3,10}$/.test(m)) continue;
    const ms = (mv ?? {}) as { done?: unknown; next?: unknown; stats?: Record<string, unknown> };
    const market: RapidMarket = { done: num(ms.done), next: num(ms.next), stats: {} };
    for (const v of RAPID_VARIANTS) {
      const r = ms.stats?.[v.id] as Partial<RapidStats> | undefined;
      if (!r) continue;
      const list = (x: unknown, keep: number) =>
        Array.isArray(x) ? x.filter((y) => Number.isFinite(y)).slice(-keep) : [];
      market.stats[v.id] = {
        n: num(r.n),
        wins: num(r.wins),
        losses: num(r.losses),
        spreads: num(r.spreads),
        dollars: num(r.dollars),
        streak: num(r.streak),
        bestWinStreak: num(r.bestWinStreak),
        worstLossStreak: num(r.worstLossStreak),
        peakOpen: num(r.peakOpen),
        openEnds: list(r.openEnds, 400),
        recent: list(r.recent, 50),
      };
    }
    out.markets[m] = market;
  }
  return out;
}

/** A fixed pseudo-random number per time, so a replay always makes the same picks. */
function pick(t: number, salt: number): number {
  let x = (Math.floor(t / 1000) + salt * 7919) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Seconds to the next entry after one at time t: 3, 4 or 5. Pure. */
export function rapidGap(t: number): number {
  const [lo, hi] = RAPID_GAP;
  return lo + Math.floor(pick(t, 3) * (hi - lo + 1));
}

/**
 * One trade: its result in spreads after the spread, and the second it
 * closed. Filled at second i's close in direction d; stop checked before the
 * take profit inside a second (the cautious way). Null when the candles
 * don't reach its time limit yet. Pure.
 */
export function rapidResult(
  secs: Sec[],
  i: number,
  d: 1 | -1,
  v: Pick<RapidVariant, "tp" | "sl" | "maxHold">,
  cost: number,
): { res: number; at: number } | null {
  const last = i + v.maxHold;
  if (last >= secs.length || cost <= 0) return null;
  const e = secs[i].c;
  for (let j = i + 1; j <= last; j++) {
    const fav = d > 0 ? secs[j].h - e : e - secs[j].l;
    const adv = d > 0 ? e - secs[j].l : secs[j].h - e;
    if (adv >= (v.sl - 1) * cost) return { res: -v.sl, at: secs[j].t };
    if (fav >= (v.tp + 1) * cost) return { res: v.tp, at: secs[j].t };
  }
  return { res: (d * (secs[last].c - e) - cost) / cost, at: secs[last].t };
}

function record(s: RapidStats, res: number, dollars: number) {
  s.n++;
  s.spreads = Math.round((s.spreads + res) * 1000) / 1000;
  s.dollars = Math.round((s.dollars + dollars) * 10000) / 10000;
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
 * Score every entry in this window that has fully played out into the
 * market's state (changed in place). Entries follow the last 3 seconds'
 * move (the last 20 when flat; none when both are flat), every 3 to 5
 * seconds, RAPID_PER_ENTRY trades each, no limit on open trades. Returns the
 * trades scored. Pure apart from the state it updates.
 */
export function scoreRapid(m: RapidMarket, secs: Sec[], cost: number, market: string): number {
  if (secs.length <= WARMUP + LONGEST + ENTRY_DELAY || cost <= 0) return 0;
  const units = UNITS_PER_MICRO_LOT[market] ?? 1;
  const lastOpen = secs.length - 1 - LONGEST - ENTRY_DELAY;
  let scored = 0;
  for (let i = WARMUP; i <= lastOpen; i++) {
    const t = secs[i].t;
    if (t <= m.done) continue;
    m.done = t;
    if (t < m.next) continue;
    m.next = t + rapidGap(t) * 1000;
    const c = secs[i].c;
    const way = Math.sign(c - secs[i - 3].c) || Math.sign(c - secs[i - 20].c);
    if (!way) continue;
    for (const v of RAPID_VARIANTS) {
      const d = (v.coin ? (pick(t, 11) < 0.5 ? 1 : -1) : way) as 1 | -1;
      const out = rapidResult(secs, i + ENTRY_DELAY, d, v, cost);
      if (!out) continue;
      const s = (m.stats[v.id] ??= emptyStats());
      const opened = secs[i + ENTRY_DELAY].t;
      s.openEnds = s.openEnds.filter((end) => end > opened);
      for (let k = 0; k < RAPID_PER_ENTRY; k++) {
        record(s, out.res, out.res * cost * units);
        s.openEnds.push(out.at);
        scored++;
      }
      s.peakOpen = Math.max(s.peakOpen, s.openEnds.length);
    }
  }
  return scored;
}

export type RapidRow = {
  id: string;
  label: string;
  n: number;
  winRate: number;
  perTrade: number;
  lately: number;
  dollars: number;
  peakOpen: number;
  worstLossStreak: number;
  bestWinStreak: number;
  /** Beats the coin flip and makes money after the spread over 1000+ trades. */
  proven: boolean;
};

/** Trades needed before rapid fire can be called proven. */
export const RAPID_PROVEN_MIN = 1000;

/** The market's rapid-fire rows, in the order of RAPID_VARIANTS. Pure. */
export function rapidBoard(m: RapidMarket | undefined): RapidRow[] {
  if (!m) return [];
  const coin = m.stats.coin;
  const coinPer = coin?.n ? coin.spreads / coin.n : -Infinity;
  return RAPID_VARIANTS.flatMap((v) => {
    const s = m.stats[v.id];
    if (!s?.n) return [];
    const perTrade = s.spreads / s.n;
    const lately = s.recent.length ? s.recent.reduce((a, b) => a + b, 0) / s.recent.length : 0;
    return [
      {
        id: v.id,
        label: v.label,
        n: s.n,
        winRate: Math.round((1000 * s.wins) / s.n) / 10,
        perTrade: Math.round(perTrade * 100) / 100,
        lately: Math.round(lately * 100) / 100,
        dollars: s.dollars,
        peakOpen: s.peakOpen,
        worstLossStreak: s.worstLossStreak,
        bestWinStreak: s.bestWinStreak,
        proven: !v.coin && s.n >= RAPID_PROVEN_MIN && perTrade > 0 && perTrade > coinPer,
      },
    ];
  });
}
