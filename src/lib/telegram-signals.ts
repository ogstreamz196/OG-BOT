export const SIGNALS_BUTTON = "📈 Signals";
export type SignalPair = "XAU" | "BTC";
export type SignalTimeframe = "1h" | "15m" | "1m";

const PAIR_LABEL: Record<SignalPair, string> = {
  XAU: "🥇 Gold (XAU/USD)",
  BTC: "₿ Bitcoin (BTC/USD)",
};

export const SIGNAL_PAIRS_TEXT =
  "📈 <b>Live signals</b>\n\nBuilt from live charts the moment you tap. Pick a market 👇";

export function signalFramesText(pair: SignalPair) {
  return (
    `📈 <b>${PAIR_LABEL[pair]}</b>\n\n` +
    "⏱ <b>1 hour</b>: intraday, held for hours\n" +
    "⚡ <b>15 mins</b>: scalp, in and out quicker\n" +
    "🎯 <b>1 min</b>: very short term, moves fast\n\nPick a timeframe 👇"
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

export function signalFramesKeyboard(pair: SignalPair) {
  return {
    inline_keyboard: [
      [
        { text: "⏱ 1 hour", callback_data: `signals:run:${pair}:1h` },
        { text: "⚡ 15 mins", callback_data: `signals:run:${pair}:15m` },
        { text: "🎯 1 min", callback_data: `signals:run:${pair}:1m` },
      ],
      [{ text: "⬅️ Markets", callback_data: "signals:pairs" }],
    ],
  };
}

export function parseSignalAction(data: string) {
  if (data === "signals:pairs") return { kind: "pairs" as const };
  const pair = /^signals:pair:(XAU|BTC)$/.exec(data);
  if (pair) return { kind: "pair" as const, pair: pair[1] as SignalPair };
  const run = /^signals:run:(XAU|BTC):(1h|15m|1m)$/.exec(data);
  if (!run) return null;
  return { kind: "run" as const, pair: run[1] as SignalPair, timeframe: run[2] as SignalTimeframe };
}

export function signalRequest(pair: SignalPair, timeframe: SignalTimeframe) {
  return `${pair === "XAU" ? "XAUUSD" : "BTCUSD"} signal ${timeframe}`;
}
