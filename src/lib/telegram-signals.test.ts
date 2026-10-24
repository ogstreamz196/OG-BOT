import { describe, expect, it } from "vitest";
import { parseSignalAction, signalRequest } from "./telegram-signals";
import { detectTradeIntent, detectStyle } from "./trade-signal";

describe("Telegram signal selections", () => {
  for (const pair of ["XAU", "BTC"] as const) {
    for (const timeframe of ["1h", "15m", "1m"] as const) {
      it(`routes ${pair} ${timeframe} to its explicit market and timeframe`, () => {
        const action = parseSignalAction(`signals:run:${pair}:${timeframe}`);
        expect(action).toEqual({ kind: "run", pair, timeframe });
        const request = signalRequest(pair, timeframe);
        expect(detectTradeIntent(request)?.code).toBe(pair === "XAU" ? "XAUUSD" : "BTCUSD");
        expect(request.split(" ").at(-1)).toBe(timeframe);
        expect(detectStyle(request)).toBe(timeframe === "1h" ? "intraday" : "scalp");
      });
    }
  }
  it("rejects unoffered markets and timeframes", () => {
    expect(parseSignalAction("signals:run:ETH:1h")).toBeNull();
    expect(parseSignalAction("signals:run:BTC:5m")).toBeNull();
    expect(parseSignalAction("signals:run:XAU:1m:extra")).toBeNull();
  });
});