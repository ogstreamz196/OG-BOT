// Named signal strategies for the TradeTweaker control room (the Boss,
// 2026-11-07). A strategy is a saved preset: a name, a note, the market and
// timeframe it trades, and a full set of the engine's knobs (Tuning). The Boss
// can add, edit and preview them. They're stored in app_settings; previewing
// runs the real engine on live Bitcoin candles. Pure and browser-safe — the
// server clamps every value with safeTuning on save.
import { DEFAULT_TUNING, type Tuning } from "./trade-signal";
import { cleanTuningPatch } from "./trade-tweaker";
import { SIGNAL_MARKETS, type SignalMarket } from "./signal-markets";

export const STRATEGIES_KEY = "signals_strategies";
export const MAX_STRATEGIES = 30;

/** The timeframes a strategy can trade (matches the backtest frames). */
export const STRAT_FRAMES = ["1H", "15M", "5M", "1M"] as const;
export type StratFrame = (typeof STRAT_FRAMES)[number];

export type SignalStrategy = {
  id: string;
  name: string;
  note: string;
  market: SignalMarket;
  frame: StratFrame;
  tuning: Tuning;
};

const uid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
};

/** A tidy name: trimmed, capped, never empty. */
export function cleanStrategyName(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
  return t || "Untitled strategy";
}

/** A fresh strategy on the engine's defaults, for "add new". */
export function newStrategy(market: SignalMarket = "BTCUSD"): SignalStrategy {
  return {
    id: uid(),
    name: "New strategy",
    note: "",
    market,
    frame: "15M",
    tuning: { ...DEFAULT_TUNING },
  };
}

/** One strategy, read back safely from stored/loose data (never throws). */
export function cleanStrategy(input: unknown): SignalStrategy | null {
  const s = (input ?? {}) as Record<string, unknown>;
  const market = (SIGNAL_MARKETS as readonly string[]).includes(String(s.market))
    ? (s.market as SignalMarket)
    : "BTCUSD";
  const frame = (STRAT_FRAMES as readonly string[]).includes(String(s.frame))
    ? (s.frame as StratFrame)
    : "15M";
  // Merge the stored knobs over the defaults so a partial or old preset still
  // yields a full Tuning; the server runs this through safeTuning on save.
  const tuning: Tuning = { ...DEFAULT_TUNING, ...cleanTuningPatch(s.tuning) };
  return {
    id: typeof s.id === "string" && s.id ? s.id : uid(),
    name: cleanStrategyName(s.name as string),
    note: typeof s.note === "string" ? s.note.slice(0, 280) : "",
    market,
    frame,
    tuning,
  };
}

/** The stored list, cleaned and capped. */
export function parseStrategies(value: string | null | undefined): SignalStrategy[] {
  let raw: unknown;
  try {
    raw = JSON.parse(value ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SignalStrategy[] = [];
  for (const item of raw.slice(0, MAX_STRATEGIES)) {
    const s = cleanStrategy(item);
    if (s) out.push(s);
  }
  return out;
}

const FRAME_LABEL: Record<StratFrame, string> = {
  "1H": "1-hour swing",
  "15M": "15-min intraday",
  "5M": "5-min scalp",
  "1M": "1-min scalp",
};
const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };
const ENTRY_LABEL = ["auto entry", "pullback", "break", "at price"];

/** A few headline facts for the strategy card. */
export function strategyBrief(s: SignalStrategy): string[] {
  const t = s.tuning;
  return [
    `${MARKET_LABEL[s.market] ?? s.market} · ${FRAME_LABEL[s.frame]}`,
    `conf ≥ ${t.minConfidence}%`,
    ENTRY_LABEL[t.entryStyle] ?? "auto entry",
    t.runner ? `runner ${t.runner}×` : "single TP",
  ];
}
