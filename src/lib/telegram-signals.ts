export const SIGNALS_BUTTON = "📈 Signals";
export type SignalPair = "XAU" | "BTC";
export type SignalTimeframe = "1h" | "15m" | "5m" | "1m";

/**
 * 1-minute signals are Boss-only: at that speed spread and slippage eat a
 * big share of the stop, so the calls are too noisy for members.
 */
export const ONE_MINUTE_RE = /\b(?:1\s?m|m1)\b/i;

/** A typed signal request moved from 1 minute to 15 minutes. */
export function withoutOneMinute(text: string): string {
  return text.replace(new RegExp(ONE_MINUTE_RE.source, "gi"), "15m");
}

// Signals in the bottom bar: tap a coin, get its live signal. Scalp (the
// 5-minute chart) by default; the Holding switch swaps the coin buttons for
// 1-hour signals and Scalp swaps them back. The bar's own labels say which
// mode it's in, so nothing has to be remembered.
export const SIGNALS_TEXT =
  "📈 <b>Signals</b>\n" +
  "Tap a coin for a live ⚡ <b>scalp</b>: 5-minute chart, quick in and out.\n" +
  "🕐 <b>Holding</b> switches to 1-hour signals you hold for hours.";

export const HOLDING_TEXT =
  "🕐 <b>Holding signals</b>\n" +
  "Tap a coin for a 1-hour signal you hold for hours.\n" +
  "⚡ <b>Scalp</b> switches back to quick 5-minute ones.";

/** Back from the signal buttons to the normal bottom bar. */
export const BACK_BUTTON = "⬅️ Back";
/** Switch the coin buttons to holding (1-hour) signals, and back to scalps. */
export const HOLDING_BUTTON = "🕐 Holding";
export const SCALP_BUTTON = "⚡ Scalp";

/** The signal buttons in the bottom bar, and what each one asks for. */
export const SIGNAL_BUTTONS: Record<
  string,
  { pair: SignalPair; timeframe: SignalTimeframe; bossOnly?: boolean }
> = {
  "🥇 Gold": { pair: "XAU", timeframe: "5m" },
  "₿ BTC": { pair: "BTC", timeframe: "5m" },
  "🥇 Gold · Holding": { pair: "XAU", timeframe: "1h" },
  "₿ BTC · Holding": { pair: "BTC", timeframe: "1h" },
  "🥇 Gold · 1 min": { pair: "XAU", timeframe: "1m", bossOnly: true },
  "₿ BTC · 1 min": { pair: "BTC", timeframe: "1m", bossOnly: true },
  // Still on some members' screens from the old four-button bar.
  "🥇 Gold · Scalp": { pair: "XAU", timeframe: "5m" },
  "₿ BTC · Scalp": { pair: "BTC", timeframe: "5m" },
};

/** Rows for the signals bottom bar (1 min is Boss-only). */
export function signalButtonRows(boss: boolean, mode: "scalp" | "holding" = "scalp"): string[][] {
  if (mode === "holding") {
    return [
      ["🥇 Gold · Holding", "₿ BTC · Holding"],
      [SCALP_BUTTON, BACK_BUTTON],
    ];
  }
  return [
    ["🥇 Gold", "₿ BTC"],
    ...(boss ? [["🥇 Gold · 1 min", "₿ BTC · 1 min"]] : []),
    [HOLDING_BUTTON, BACK_BUTTON],
  ];
}

/**
 * Inline signal buttons from older messages (callback_data "signals:…").
 * Only "run" still does something; the rest open the bottom-bar signals.
 */
export function parseSignalAction(data: string) {
  if (data === "signals:pairs") return { kind: "pairs" as const };
  const pair = /^signals:pair:(XAU|BTC)$/.exec(data);
  if (pair) return { kind: "pair" as const, pair: pair[1] as SignalPair };
  const run = /^signals:run:(XAU|BTC):(1h|15m|5m|1m)$/.exec(data);
  if (!run) return null;
  return { kind: "run" as const, pair: run[1] as SignalPair, timeframe: run[2] as SignalTimeframe };
}

export function signalRequest(pair: SignalPair, timeframe: SignalTimeframe) {
  return `${pair === "XAU" ? "XAUUSD" : "BTCUSD"} signal ${timeframe}`;
}
