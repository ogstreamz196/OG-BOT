export const SIGNALS_BUTTON = "📈 Signals";
export type SignalPair = "XAU" | "BTC";
export type SignalTimeframe = "1h" | "15m" | "1m";

export function signalPairsKeyboard() {
  return { inline_keyboard: [[
    { text: "XAU", callback_data: "signals:pair:XAU" },
    { text: "BTC", callback_data: "signals:pair:BTC" },
  ]] };
}

export function signalFramesKeyboard(pair: SignalPair) {
  return { inline_keyboard: [
    [
      { text: "1 hour", callback_data: `signals:run:${pair}:1h` },
      { text: "15 mins", callback_data: `signals:run:${pair}:15m` },
      { text: "1 min", callback_data: `signals:run:${pair}:1m` },
    ],
    [{ text: "⬅️ Pairs", callback_data: "signals:pairs" }],
  ] };
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