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
export type EngineConfig = { gate: GateConfig; concurrency: ConcurrencyConfig };

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
};

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

/** Merge a loose/partial config over the defaults and clamp every value. */
export function cleanEngineConfig(input: unknown): EngineConfig {
  const src = (input ?? {}) as {
    gate?: Record<string, unknown>;
    concurrency?: Record<string, unknown>;
  };
  const g = src.gate ?? {};
  const c = src.concurrency ?? {};
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
  };
}
