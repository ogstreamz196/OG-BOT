// Engine-wide signal settings the Boss can edit from TradeTweaker (2026-11-07):
// the posting gate and the concurrency limits. These were fixed constants in
// signal-gate.ts and signal-broadcast.server.ts; now they can be overridden by
// a stored config. The defaults here MUST equal those constants (a test checks
// it), so an unset or partial config never changes live behaviour. Pure and
// browser-safe; the server clamps with ENGINE_BOUNDS on save and the live path
// loads it (engine-config.server.ts) with a safe fallback to these defaults.

export const ENGINE_CONFIG_KEY = "signals_engine_config";

export type GateConfig = {
  minConfidence: number;
  minRecord: number;
  badEdge: number;
  minWinRate: number;
  minWinRateTrades: number;
  quietMin: number;
};
export type ConcurrencyConfig = {
  free: number;
  step: number;
  barMax: number;
  perMarket: number;
  sameSideGapMins: number;
  afterStopMins: number;
  sameSetupR: number;
};
/**
 * The Boss's strategy on/off toggles (Telegram buttons, like the copier's
 * high-frequency switch). Several strategies run at once; these turn each one
 * on or off without a code change. All off by default, so live posting is
 * exactly as it was until the Boss flips one.
 */
export type StrategyToggles = {
  /** Force the sniper entry (entryStyle 4) on every market, over the learner. */
  sniper: boolean;
  /** Counter-trend hedges (the other side) while a trend trade still runs. */
  hedges: boolean;
  /** Extra buy/sell hedges that fight each other when a market is ranging. */
  rangeHedge: boolean;
  /** Run the proven patterns alongside the engine, not only when it says wait. */
  patternsAlongside: boolean;
};
export type EngineConfig = {
  gate: GateConfig;
  concurrency: ConcurrencyConfig;
  strategies: StrategyToggles;
};

/** The strategy toggles in the order the Telegram card shows them. */
export const STRATEGY_KEYS: readonly (keyof StrategyToggles)[] = [
  "sniper",
  "hedges",
  "rangeHedge",
  "patternsAlongside",
];

/** Defaults = the current code constants. Changing these changes live defaults. */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  gate: {
    minConfidence: 65,
    minRecord: 8,
    badEdge: -0.3,
    minWinRate: 0.42,
    minWinRateTrades: 12,
    quietMin: 15,
  },
  concurrency: {
    free: 3,
    step: 2,
    barMax: 84,
    perMarket: 10,
    sameSideGapMins: 1.5,
    afterStopMins: 3,
    sameSetupR: 0.3,
  },
  // All off: live posting is unchanged until the Boss turns one on.
  strategies: {
    sniper: false,
    hedges: false,
    rangeHedge: false,
    patternsAlongside: false,
  },
};

/**
 * High-frequency mode (the copier card's switch) for the posting limits: no
 * cap on trades per market, no rising confidence bar as more run, and shorter
 * waits (30s between same-side entries, 1 minute after a stop). The posting
 * gate, the room checks and "not the same setup twice" all stay. Pure.
 */
export function hftConcurrency(c: ConcurrencyConfig): ConcurrencyConfig {
  return {
    ...c,
    free: Number.POSITIVE_INFINITY,
    perMarket: Number.POSITIVE_INFINITY,
    sameSideGapMins: Math.min(c.sameSideGapMins, 0.5),
    afterStopMins: Math.min(c.afterStopMins, 1),
  };
}
/** Hedges a market may run at once: one normally, up to three in high-frequency mode. */
export const hedgesPerMarket = (hft: boolean) => (hft ? 3 : 1);
/** Range hedges per side of a market: one normally, two in high-frequency mode. */
export const rangeHedgesPerSide = (hft: boolean) => (hft ? 2 : 1);
/** How often the hedge, range and alongside steps may read a market's chart. */
export const stepEveryMs = (hft: boolean) => (hft ? 20_000 : 60_000);

type Range = readonly [number, number];
export const ENGINE_BOUNDS: {
  gate: Record<keyof GateConfig, Range>;
  concurrency: Record<keyof ConcurrencyConfig, Range>;
} = {
  gate: {
    minConfidence: [51, 90],
    minRecord: [3, 30],
    badEdge: [-1, 0],
    minWinRate: [0.2, 0.7],
    minWinRateTrades: [5, 40],
    quietMin: [5, 180],
  },
  concurrency: {
    free: [1, 10],
    step: [0, 10],
    barMax: [60, 90],
    perMarket: [1, 20],
    sameSideGapMins: [0, 30],
    afterStopMins: [0, 30],
    sameSetupR: [0, 2],
  },
};

const clamp = (v: unknown, [lo, hi]: Range, fallback: number) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const round2 = (n: number) => Math.round(n * 100) / 100;

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Merge a loose/partial config over the defaults and clamp every value. */
export function cleanEngineConfig(input: unknown): EngineConfig {
  const src = (input ?? {}) as {
    gate?: Record<string, unknown>;
    concurrency?: Record<string, unknown>;
    strategies?: Record<string, unknown>;
  };
  const g = src.gate ?? {};
  const c = src.concurrency ?? {};
  const st = src.strategies ?? {};
  const d = DEFAULT_ENGINE_CONFIG;
  const gb = ENGINE_BOUNDS.gate;
  const cb = ENGINE_BOUNDS.concurrency;
  return {
    gate: {
      minConfidence: Math.round(clamp(g.minConfidence, gb.minConfidence, d.gate.minConfidence)),
      minRecord: Math.round(clamp(g.minRecord, gb.minRecord, d.gate.minRecord)),
      badEdge: round2(clamp(g.badEdge, gb.badEdge, d.gate.badEdge)),
      minWinRate: round2(clamp(g.minWinRate, gb.minWinRate, d.gate.minWinRate)),
      minWinRateTrades: Math.round(
        clamp(g.minWinRateTrades, gb.minWinRateTrades, d.gate.minWinRateTrades),
      ),
      quietMin: Math.round(clamp(g.quietMin, gb.quietMin, d.gate.quietMin)),
    },
    concurrency: {
      free: Math.round(clamp(c.free, cb.free, d.concurrency.free)),
      step: Math.round(clamp(c.step, cb.step, d.concurrency.step)),
      barMax: Math.round(clamp(c.barMax, cb.barMax, d.concurrency.barMax)),
      perMarket: Math.round(clamp(c.perMarket, cb.perMarket, d.concurrency.perMarket)),
      sameSideGapMins: round2(
        clamp(c.sameSideGapMins, cb.sameSideGapMins, d.concurrency.sameSideGapMins),
      ),
      afterStopMins: round2(clamp(c.afterStopMins, cb.afterStopMins, d.concurrency.afterStopMins)),
      sameSetupR: round2(clamp(c.sameSetupR, cb.sameSetupR, d.concurrency.sameSetupR)),
    },
    strategies: {
      sniper: bool(st.sniper, d.strategies.sniper),
      hedges: bool(st.hedges, d.strategies.hedges),
      rangeHedge: bool(st.rangeHedge, d.strategies.rangeHedge),
      patternsAlongside: bool(st.patternsAlongside, d.strategies.patternsAlongside),
    },
  };
}
