import { describe, expect, it } from "vitest";
import {
  aggregate,
  atr,
  buildPlan,
  detectStyle,
  detectTradeIntent,
  resolveTradeRequest,
  ema,
  parseInstrument,
  readFrame,
  rsi,
  validityWindow,
  holdingMessage,
  isHoldingMessage,
  tagSignalExpiry,
  signalExpiry,
  stripSignalTag,
  cleanTradeHistory,
  EXPIRED_SIGNAL_NOTE,
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
  it("resolves the reported BTC follow-up without inheriting old prices", () => {
    const now = Date.UTC(2026, 9, 23, 22, 48);
    expect(resolveTradeRequest("Give me a signal", [{
      role: "user", content: "Is btcusd bullish or bearish im down 25k this week",
      created_at: new Date(now - 60_000).toISOString(),
    }], now)).toBe("BTCUSD Give me a signal");
  });

  it("does not infer a market from stale, assistant-only or unrelated history", () => {
    const now = Date.UTC(2026, 9, 23, 22, 48);
    const old = { role: "user", content: "BTC signal", created_at: new Date(now - 31 * 60_000).toISOString() };
    expect(resolveTradeRequest("Give me a signal", [old], now)).toBeNull();
    expect(resolveTradeRequest("Give me a signal", [{ ...old, role: "assistant", created_at: new Date(now).toISOString() }], now)).toBeNull();
    expect(resolveTradeRequest("Give me a signal", [
      { ...old, content: "what time is the game", created_at: new Date(now).toISOString() },
      { ...old, created_at: new Date(now - 60_000).toISOString() },
    ], now)).toBeNull();
    expect(resolveTradeRequest("ETH signal", [old], now)).toBe("ETH signal");
  });

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

describe("holdingMessage", () => {
  const gold = parseInstrument("gold")!;
  it("names the market and is tagged so history can skip it", () => {
    for (const tone of ["foul", "cheeky", "safe"] as const) {
      const msg = holdingMessage(gold, tone, () => 0);
      expect(msg).toContain("XAU/USD (Gold)");
      expect(msg).toMatch(/next message/i);
      expect(isHoldingMessage(msg)).toBe(true);
    }
    expect(isHoldingMessage("normal reply")).toBe(false);
  });

  it("keeps the clean tone clean", () => {
    for (let i = 0; i < 10; i++) {
      expect(holdingMessage(gold, "safe", () => i / 10)).not.toMatch(
        /fuck|shit|bastard|bellend|sod/i,
      );
    }
  });
});

describe("signal expiry tag", () => {
  const at = "2026-10-16T16:00:00.000Z";
  it("round-trips the expiry and strips cleanly", () => {
    const tagged = tagSignalExpiry("📊 XAU/USD — BUY", at);
    expect(signalExpiry(tagged)?.toISOString()).toBe(at);
    expect(stripSignalTag(tagged)).toBe("📊 XAU/USD — BUY");
    expect(signalExpiry("plain reply")).toBeNull();
  });

  it("cleans history: drops holding lines, hides expired levels, untags live ones", () => {
    const gold = parseInstrument("gold")!;
    const msgs = [
      { role: "user", content: "gold signal" },
      { role: "assistant", content: holdingMessage(gold, "safe", () => 0) },
      { role: "assistant", content: tagSignalExpiry("BUY 2400 SL 2390", at) },
      { role: "user", content: "btc signal" },
      { role: "assistant", content: tagSignalExpiry("SELL 70000", "2026-10-16T20:00:00.000Z") },
    ];
    const out = cleanTradeHistory(msgs, Date.parse("2026-10-16T17:00:00.000Z"));
    expect(out).toHaveLength(4);
    expect(out[1].content).toBe(EXPIRED_SIGNAL_NOTE);
    expect(out[3].content).toBe("SELL 70000");
  });
});
