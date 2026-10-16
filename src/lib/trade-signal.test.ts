import { describe, expect, it } from "vitest";
import {
  aggregate,
  atr,
  buildPlan,
  detectStyle,
  detectTradeIntent,
  ema,
  parseInstrument,
  readFrame,
  rsi,
  validityWindow,
  type Candle,
} from "./trade-signal";

/** Steady trend with a gentle wiggle so swings exist. */
function series(n: number, start: number, step: number, hours = 1): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + step * i + Math.sin(i / 3) * Math.abs(step) * 4;
    return {
      t: Date.UTC(2026, 0, 1) + i * hours * 3600_000,
      o: mid,
      h: mid + Math.abs(step) * 2,
      l: mid - Math.abs(step) * 2,
      c: mid,
    };
  });
}

describe("parseInstrument", () => {
  it.each([
    ["give me a signal for EURUSD", "EURUSD", "forex"],
    ["the eur/usd setup", "EURUSD", "forex"],
    ["gbp jpy entry?", "GBPJPY", "forex"],
    ["xauusd", "XAUUSD", "metal"],
    ["what's gold doing", "XAUUSD", "metal"],
    ["BTC signal", "BTCUSD", "crypto"],
    ["btcusdt long?", "BTCUSD", "crypto"],
    ["ethereum analysis", "ETHUSD", "crypto"],
    ["$SOL setup", "SOLUSD", "crypto"],
    ["us30 sell?", "US30", "index"],
    ["nas100 levels", "NAS100", "index"],
    ["$AAPL entry", "AAPL", "stock"],
  ])("%s → %s", (text, code, asset) => {
    const inst = parseInstrument(text);
    expect(inst?.code).toBe(code);
    expect(inst?.asset).toBe(asset);
  });

  it("ignores everyday words that happen to be tickers", () => {
    expect(parseInstrument("is there a good place to buy near me")).toBeNull();
    expect(parseInstrument("send me the link")).toBeNull();
    expect(parseInstrument("the cat sat on the mat")).toBeNull();
  });

  it("uses JPY pip size for yen pairs", () => {
    expect(parseInstrument("USDJPY")?.pip).toBe(0.01);
    expect(parseInstrument("EURUSD")?.pip).toBe(0.0001);
  });
});

describe("detectTradeIntent", () => {
  it("needs a market plus a trade word (or just the market)", () => {
    expect(detectTradeIntent("signal on xauusd pls")?.code).toBe("XAUUSD");
    expect(detectTradeIntent("EURUSD?")?.code).toBe("EURUSD");
    expect(
      detectTradeIntent("my nan gave me a gold chain for christmas, isn't that lovely"),
    ).toBeNull();
    expect(detectTradeIntent("give me a trade signal")).toBeNull();
    expect(detectTradeIntent("ta mate")).toBeNull();
  });

  it("reads the trading style", () => {
    expect(detectStyle("quick scalp on gold")).toBe("scalp");
    expect(detectStyle("swing trade btc")).toBe("swing");
    expect(detectStyle("eurusd signal")).toBe("intraday");
  });
});

describe("indicators", () => {
  it("ema matches a hand calculation", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it("rsi is high in an uptrend and low in a downtrend", () => {
    const up = Array.from({ length: 50 }, (_, i) => 100 + i + (i % 3 === 0 ? -0.5 : 0));
    const down = up.map((v) => 300 - v);
    expect(rsi(up)).toBeGreaterThan(70);
    expect(rsi(down)).toBeLessThan(30);
  });

  it("atr equals the bar range for flat bars", () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 10, h: 11, l: 9, c: 10 }));
    expect(atr(flat)).toBeCloseTo(2);
  });

  it("aggregates hourly bars into 4H bars", () => {
    const h = series(8, 100, 1);
    const four = aggregate(h, 4);
    expect(four).toHaveLength(2);
    expect(four[0].h).toBe(Math.max(...h.slice(0, 4).map((c) => c.h)));
    expect(four[1].c).toBe(h[7].c);
  });
});

describe("buildPlan", () => {
  it("calls BUY in an aligned uptrend with stop below and targets above", () => {
    const d = series(300, 1000, 2, 24);
    const h = series(1000, 1400, 0.5);
    const h4 = aggregate(h, 4);
    const plan = buildPlan(
      readFrame("Daily", d)!,
      readFrame("4H", h4)!,
      readFrame("1H", h)!,
      h,
      h4,
    );
    expect(plan.direction).toBe("BUY");
    expect(plan.stop!).toBeLessThan(plan.entry!);
    expect(plan.targets[0]).toBeGreaterThan(plan.entry!);
    expect(plan.targets[1]).toBeGreaterThan(plan.targets[0]);
    expect(plan.targets[2]).toBeGreaterThanOrEqual(plan.targets[1]);
    // 1R target mirrors the stop distance
    expect(plan.targets[0] - plan.entry!).toBeCloseTo(plan.entry! - plan.stop!);
  });

  it("calls SELL in an aligned downtrend", () => {
    const d = series(300, 2000, -2, 24);
    const h = series(1000, 1500, -0.5);
    const h4 = aggregate(h, 4);
    const plan = buildPlan(
      readFrame("Daily", d)!,
      readFrame("4H", h4)!,
      readFrame("1H", h)!,
      h,
      h4,
    );
    expect(plan.direction).toBe("SELL");
    expect(plan.stop!).toBeGreaterThan(plan.entry!);
    expect(plan.targets[0]).toBeLessThan(plan.entry!);
  });

  it("still names the most likely side when timeframes disagree, with low confidence", () => {
    const d = series(300, 2000, -2, 24);
    const h = series(1000, 1400, 0.5);
    const h4 = aggregate(h, 4);
    const plan = buildPlan(
      readFrame("Daily", d)!,
      readFrame("4H", h4)!,
      readFrame("1H", h)!,
      h,
      h4,
    );
    expect(["BUY", "SELL"]).toContain(plan.direction);
    expect(plan.caution).toMatch(/mixed/);
    expect(plan.confidencePct).toBeGreaterThanOrEqual(51);
    expect(plan.confidencePct).toBeLessThan(75);
    expect(Number.isFinite(plan.stop)).toBe(true);
  });

  it("gives aligned trends a higher confidence than mixed ones", () => {
    const up = series(300, 1000, 2, 24);
    const down = series(300, 2000, -2, 24);
    const h = series(1000, 1400, 0.5);
    const h4 = aggregate(h, 4);
    const aligned = buildPlan(
      readFrame("Daily", up)!,
      readFrame("4H", h4)!,
      readFrame("1H", h)!,
      h,
      h4,
    );
    const mixed = buildPlan(
      readFrame("Daily", down)!,
      readFrame("4H", h4)!,
      readFrame("1H", h)!,
      h,
      h4,
    );
    expect(aligned.caution).toBeUndefined();
    expect(aligned.confidencePct).toBeGreaterThan(mixed.confidencePct);
    expect(aligned.confidencePct).toBeLessThanOrEqual(90);
  });
});

describe("validityWindow", () => {
  it("is short for scalps, a session for intraday and days for swings", () => {
    const now = Date.UTC(2026, 9, 16, 12, 0);
    expect(validityWindow("scalp", now).until.toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(validityWindow("intraday", now).hours).toBe(4);
    expect(validityWindow("swing", now).hours).toBe(24);
  });
});
