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
  it("members get Holding and Scalp for gold and bitcoin, the Boss also gets 1 min", async () => {
    const { SIGNAL_BUTTONS, signalButtonRows, BACK_BUTTON } = await import("./telegram-signals");
    const member = signalButtonRows(false).flat();
    expect(member).toEqual([
      "🥇 Gold · Holding",
      "🥇 Gold · Scalp",
      "₿ BTC · Holding",
      "₿ BTC · Scalp",
      BACK_BUTTON,
    ]);
    expect(signalButtonRows(true).flat()).toContain("₿ BTC · 1 min");
    // No 15-minute button any more.
    expect(Object.values(SIGNAL_BUTTONS).some((b) => b.timeframe === "15m")).toBe(false);
    for (const label of signalButtonRows(true).flat()) {
      if (label === BACK_BUTTON) continue;
      const b = SIGNAL_BUTTONS[label];
      const request = signalRequest(b.pair, b.timeframe);
      expect(detectTradeIntent(request)?.code).toBe(b.pair === "XAU" ? "XAUUSD" : "BTCUSD");
      expect(detectStyle(request)).toBe(b.timeframe === "1h" ? "intraday" : "scalp");
    }
    expect(SIGNAL_BUTTONS["🥇 Gold · Scalp"].timeframe).toBe("5m");
  });
});
