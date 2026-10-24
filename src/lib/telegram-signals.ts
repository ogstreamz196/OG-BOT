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

export const SIGNALS_TEXT =
  "📈 <b>Signals</b>\n" +
  "🕐 <b>Holding</b>: 1-hour chart, held for hours.\n" +
  "⚡ <b>Scalp</b>: 5-minute chart, quick in and out.\n" +
  "Pick one at the bottom 👇";

/** Back from the signal buttons to the normal bottom bar. */
export const BACK_BUTTON = "⬅️ Back";

/** The signal buttons in the bottom bar, and what each one asks for. */
export const SIGNAL_BUTTONS: Record<
  string,
  { pair: SignalPair; timeframe: SignalTimeframe; bossOnly?: boolean }
> = {
  "🥇 Gold · Holding": { pair: "XAU", timeframe: "1h" },
  "🥇 Gold · Scalp": { pair: "XAU", timeframe: "5m" },
  "₿ BTC · Holding": { pair: "BTC", timeframe: "1h" },
  "₿ BTC · Scalp": { pair: "BTC", timeframe: "5m" },
  "🥇 Gold · 1 min": { pair: "XAU", timeframe: "1m", bossOnly: true },
  "₿ BTC · 1 min": { pair: "BTC", timeframe: "1m", bossOnly: true },
};

/** Rows for the signals bottom bar (1 min is Boss-only). */
export function signalButtonRows(boss: boolean): string[][] {
  return [
    ["🥇 Gold · Holding", "🥇 Gold · Scalp"],
    ["₿ BTC · Holding", "₿ BTC · Scalp"],
    ...(boss ? [["🥇 Gold · 1 min", "₿ BTC · 1 min"]] : []),
    [BACK_BUTTON],
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
