export const SIGNALS_BUTTON = "📈 Signals";
export type SignalPair = "XAU" | "BTC";
export type SignalTimeframe = "1h" | "15m" | "5m" | "1m";

const PAIR_LABEL: Record<SignalPair, string> = {
  XAU: "🥇 Gold (XAU/USD)",
  BTC: "₿ Bitcoin (BTC/USD)",
};

export const SIGNAL_PAIRS_TEXT =
  "📈 <b>Live signals</b>\n\nBuilt from live charts the moment you tap. Pick a market 👇";

/**
 * 1-minute signals are Boss-only: at that speed spread and slippage eat a
 * big share of the stop, so the calls are too noisy for members.
 */
export const ONE_MINUTE_RE = /\b(?:1\s?m|m1)\b/i;

/** A typed signal request moved from 1 minute to 15 minutes. */
export function withoutOneMinute(text: string): string {
  return text.replace(new RegExp(ONE_MINUTE_RE.source, "gi"), "15m");
}

export function signalFramesText(pair: SignalPair, oneMinute = true) {
  return (
    `📈 <b>${PAIR_LABEL[pair]}</b>\n\n` +
    "🕐 <b>Holding signal</b>: 1-hour chart, held for hours\n" +
    "⚡ <b>Scalp signal</b>: 5-minute chart, quick in and out\n" +
    "15 mins sits in between" +
    (oneMinute ? ", 1 min is the fastest" : "") +
    ".\n\nPick one 👇"
  );
}

export function signalPairsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: PAIR_LABEL.XAU, callback_data: "signals:pair:XAU" },
        { text: PAIR_LABEL.BTC, callback_data: "signals:pair:BTC" },
      ],
    ],
  };
}

export function signalFramesKeyboard(pair: SignalPair, oneMinute = true) {
  return {
    inline_keyboard: [
      [
        { text: "🕐 Holding signal", callback_data: `signals:run:${pair}:1h` },
        { text: "⚡ Scalp signal", callback_data: `signals:run:${pair}:5m` },
      ],
      [
        { text: "15 mins", callback_data: `signals:run:${pair}:15m` },
        ...(oneMinute ? [{ text: "1 min", callback_data: `signals:run:${pair}:1m` }] : []),
      ],
      [{ text: "⬅️ Markets", callback_data: "signals:pairs" }],
    ],
  };
}

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
