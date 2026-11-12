// The Boss's strategy on/off switches inside the signals bot on Telegram (the
// Boss, 2026-11-12: "give me the toggles to turn on and off these strategies
// same as hft in telegram"). A settings card with tap buttons that edits
// itself in place, Boss only. It edits the strategy toggles in the stored
// engine config (ENGINE_CONFIG_KEY, cleanEngineConfig in engine-config.ts),
// which the live scan reads each minute. Several strategies run at once; each
// button turns one on or off. Pure: the card text, the keyboard and the tap
// handler are all testable without the bot or the database.
import {
  cleanEngineConfig,
  STRATEGY_KEYS,
  type EngineConfig,
  type StrategyToggles,
} from "./engine-config";

export const OPEN_STRATEGIES_BUTTON = "🎛 Strategies";

/** What each toggle is and does, in plain words. */
const STRATEGY_INFO: Record<keyof StrategyToggles, { name: string; blurb: string }> = {
  sniper: {
    name: "🎯 Sniper entries",
    blurb: "Limit back into the last gap or a retest, with a tight structure stop.",
  },
  hedges: {
    name: "⚖️ Counter-trend hedges",
    blurb: "Let proven reversals post the other side while a trend trade still runs.",
  },
  rangeHedge: {
    name: "🔁 Range hedging",
    blurb:
      "When a market is just ranging, buys and sells that fight each other instead of chasing take-profit.",
  },
  patternsAlongside: {
    name: "➕ Patterns alongside",
    blurb: "Run the proven patterns next to the main engine, not only when it says wait.",
  },
};

/** The strategies card text: each switch, on or off, in plain words. Pure. */
export function strategyPanelText(cfg: EngineConfig, note?: string): string {
  const s = cfg.strategies;
  return [
    ...(note ? [note, ""] : []),
    "🎛 SIGNAL STRATEGIES",
    "Several run at once. Tap a button to turn one on or off; it takes effect on the next scan.",
    "",
    ...STRATEGY_KEYS.flatMap((k) => [
      `${s[k] ? "✅ ON" : "⬜️ OFF"} — ${STRATEGY_INFO[k].name}`,
      `   ${STRATEGY_INFO[k].blurb}`,
    ]),
    "",
    "All off is the engine as it was: the learner decides entries and the extra setups earn their place.",
  ].join("\n");
}

type Button = { text: string; callback_data: string };

/** The card's tap buttons, one per strategy plus refresh. Pure. */
export function strategyPanelKeyboard(cfg: EngineConfig): { inline_keyboard: Button[][] } {
  const s = cfg.strategies;
  return {
    inline_keyboard: [
      ...STRATEGY_KEYS.map((k) => [
        {
          text: `${STRATEGY_INFO[k].name}: ${s[k] ? "ON · tap to turn off" : "OFF · tap to turn on"}`,
          callback_data: `es:${k}:${s[k] ? "off" : "on"}`,
        },
      ]),
      [{ text: "🔄 Refresh", callback_data: "es:refresh" }],
    ],
  };
}

/**
 * One button tap on the strategies card: the new config and the toast to show,
 * or next null when nothing changes (refresh, an unknown key). Pure.
 */
export function applyStrategyTap(
  current: EngineConfig,
  data: string,
): { next: EngineConfig | null; toast: string } {
  const [, key, val] = data.split(":");
  if (key === "refresh") return { next: null, toast: "Up to date" };
  if (!(STRATEGY_KEYS as readonly string[]).includes(key) || (val !== "on" && val !== "off"))
    return { next: null, toast: "" };
  const on = val === "on";
  const next = cleanEngineConfig({
    ...current,
    strategies: { ...current.strategies, [key]: on },
  });
  return {
    next,
    toast: `${STRATEGY_INFO[key as keyof StrategyToggles].name}: ${on ? "ON" : "OFF"}`,
  };
}

/** The strategies button (or "/strategies") normalised to the command. Pure. */
export function asStrategyCommand(text: string): string | null {
  const t = text.trim();
  if (t === OPEN_STRATEGIES_BUTTON || /^\/?strategies$/i.test(t)) return "/strategies";
  return null;
}
