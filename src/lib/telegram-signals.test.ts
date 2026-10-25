import { describe, expect, it } from "vitest";
import { parseSignalAction, signalRequest } from "./telegram-signals";
import { detectTradeIntent, detectStyle } from "./trade-signal";

describe("Telegram signal selections", () => {
  for (const pair of ["XAU", "BTC"] as const) {
    for (const timeframe of ["1h", "15m", "5m", "1m"] as const) {
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
    expect(parseSignalAction("signals:run:BTC:30m")).toBeNull();
    expect(parseSignalAction("signals:run:XAU:1m:extra")).toBeNull();
  });
});

describe("signal buttons in the bottom bar", () => {
  it("a coin tap is a scalp; the Holding switch swaps in 1-hour coins; the Boss also gets 1 min", async () => {
    const { SIGNAL_BUTTONS, signalButtonRows, BACK_BUTTON, HOLDING_BUTTON, SCALP_BUTTON } =
      await import("./telegram-signals");
    expect(signalButtonRows(false)).toEqual([
      ["🥇 Gold", "₿ BTC"],
      [HOLDING_BUTTON, BACK_BUTTON],
    ]);
    expect(signalButtonRows(false, "holding")).toEqual([
      ["🥇 Gold · Holding", "₿ BTC · Holding"],
      [SCALP_BUTTON, BACK_BUTTON],
    ]);
    expect(signalButtonRows(true).flat()).toContain("₿ BTC · 1 min");
    expect(SIGNAL_BUTTONS["🥇 Gold"]).toEqual({ pair: "XAU", timeframe: "5m" });
    expect(SIGNAL_BUTTONS["₿ BTC"]).toEqual({ pair: "BTC", timeframe: "5m" });
    expect(SIGNAL_BUTTONS["₿ BTC · Holding"]).toEqual({ pair: "BTC", timeframe: "1h" });
    // No 15-minute button any more.
    expect(Object.values(SIGNAL_BUTTONS).some((b) => b.timeframe === "15m")).toBe(false);
    const coins = [...signalButtonRows(true).flat(), ...signalButtonRows(true, "holding").flat()];
    for (const label of coins) {
      if ([BACK_BUTTON, HOLDING_BUTTON, SCALP_BUTTON].includes(label)) continue;
      const b = SIGNAL_BUTTONS[label];
      const request = signalRequest(b.pair, b.timeframe);
      expect(detectTradeIntent(request)?.code).toBe(b.pair === "XAU" ? "XAUUSD" : "BTCUSD");
      expect(detectStyle(request)).toBe(b.timeframe === "1h" ? "intraday" : "scalp");
    }
    // Buttons from the old four-button bar still work.
    expect(SIGNAL_BUTTONS["🥇 Gold · Scalp"].timeframe).toBe("5m");
  });
});
