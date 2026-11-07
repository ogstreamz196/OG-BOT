import { describe, expect, it } from "vitest";
import { cleanEngineConfig, DEFAULT_ENGINE_CONFIG } from "./engine-config";
import {
  POST_MIN_CONFIDENCE,
  POST_MIN_RECORD,
  POST_BAD_EDGE,
  POST_MIN_WINRATE,
  POST_MIN_WINRATE_TRADES,
  POST_QUIET_MIN,
} from "./signal-gate";
import {
  CONCURRENCY_FREE,
  CONCURRENCY_STEP,
  CONCURRENCY_BAR_MAX,
  MAX_RUNNING_PER_MARKET,
  SAME_SIDE_GAP_MS,
  AFTER_STOP_MS,
  SAME_SETUP_R,
} from "./signal-broadcast.server";

describe("engine config defaults match the live constants", () => {
  it("gate defaults equal signal-gate's constants (so unset = no change)", () => {
    expect(DEFAULT_ENGINE_CONFIG.gate).toEqual({
      minConfidence: POST_MIN_CONFIDENCE,
      minRecord: POST_MIN_RECORD,
      badEdge: POST_BAD_EDGE,
      minWinRate: POST_MIN_WINRATE,
      minWinRateTrades: POST_MIN_WINRATE_TRADES,
      quietMin: POST_QUIET_MIN,
    });
  });
  it("concurrency defaults equal signal-broadcast's constants", () => {
    expect(DEFAULT_ENGINE_CONFIG.concurrency).toEqual({
      free: CONCURRENCY_FREE,
      step: CONCURRENCY_STEP,
      barMax: CONCURRENCY_BAR_MAX,
      perMarket: MAX_RUNNING_PER_MARKET,
      sameSideGapMins: SAME_SIDE_GAP_MS / 60_000,
      afterStopMins: AFTER_STOP_MS / 60_000,
      sameSetupR: SAME_SETUP_R,
    });
  });
});

describe("cleanEngineConfig", () => {
  it("fills missing values from defaults and keeps a clean full config", () => {
    expect(cleanEngineConfig({})).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(cleanEngineConfig(null)).toEqual(DEFAULT_ENGINE_CONFIG);
  });
  it("clamps out-of-range values to the bounds", () => {
    const c = cleanEngineConfig({
      gate: { minConfidence: 999, minWinRate: -1 },
      concurrency: { perMarket: 0, barMax: 1000 },
    });
    expect(c.gate.minConfidence).toBe(90);
    expect(c.gate.minWinRate).toBe(0.2);
    expect(c.concurrency.perMarket).toBe(1);
    expect(c.concurrency.barMax).toBe(90);
  });
  it("coerces numeric strings and rounds integer fields", () => {
    const c = cleanEngineConfig({ gate: { minConfidence: "73" }, concurrency: { free: "4" } });
    expect(c.gate.minConfidence).toBe(73);
    expect(c.concurrency.free).toBe(4);
  });
});
