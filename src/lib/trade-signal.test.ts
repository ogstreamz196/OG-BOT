import { describe, expect, it } from "vitest";
import {
  aggregate,
  atr,
  buildPlan,
  detectStyle,
  detectTradeIntent,
  resolveTradeRequest,
  STOP_ROOM,
  isAnyMarketAsk,
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
  fastFrame,
  framesFor,
  sessionRead,
  type Candle,
  type FrameRead,
  scaleTargets,
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
    expect(
      resolveTradeRequest(
        "Give me a signal",
        [
          {
            role: "user",
            content: "Is btcusd bullish or bearish im down 25k this week",
            created_at: new Date(now - 60_000).toISOString(),
          },
        ],
        now,
      ),
    ).toBe("BTCUSD Give me a signal");
  });

  it("does not infer a market from stale, assistant-only or unrelated history", () => {
    const now = Date.UTC(2026, 9, 23, 22, 48);
    const old = {
      role: "user",
      content: "BTC signal",
      created_at: new Date(now - 31 * 60_000).toISOString(),
    };
    expect(resolveTradeRequest("Give me a signal", [old], now)).toBeNull();
    expect(
      resolveTradeRequest(
        "Give me a signal",
        [{ ...old, role: "assistant", created_at: new Date(now).toISOString() }],
        now,
      ),
    ).toBeNull();
    expect(
      resolveTradeRequest(
        "Give me a signal",
        [
          { ...old, content: "what time is the game", created_at: new Date(now).toISOString() },
          { ...old, created_at: new Date(now - 60_000).toISOString() },
        ],
        now,
      ),
    ).toBeNull();
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
    // Quick Scalp sits at 0.8R: 20% closer than the engine's 1R TP1. The
    // stop sits 20% further out than that R, and the R:R uses that stop.
    const engineRisk = (plan.entry! - plan.stop!) / STOP_ROOM;
    expect(plan.targets[0] - plan.entry!).toBeCloseTo(engineRisk * 0.8);
    expect(plan.rr.startsWith("1:0.7 /")).toBe(true);
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

describe("buildPlan accuracy rules", () => {
  const d = series(300, 2000, -2, 24);
  const h = series(1000, 1500, -0.5);
  const h4 = aggregate(h, 4);
  const hi = readFrame("Daily", d)!;
  const mid = readFrame("4H", h4)!;
  const lo = readFrame("1H", h)!;
  // Same downtrend, but the 1H MACD is positive and rising (momentum against a SELL).
  const against: FrameRead = {
    ...lo,
    ema20: lo.close,
    rsi: 45,
    macdHist: Math.abs(lo.macdHist) + 1,
    macdRising: true,
  };

  it("waits for confirmation when short-term momentum is against the trade", () => {
    const plan = buildPlan(hi, mid, against, h, h4);
    const base = buildPlan(hi, mid, lo, h, h4);
    expect(plan.direction).toBe("SELL");
    expect(plan.entryType).toBe("stop");
    // A sell stop sits below the last two candles.
    expect(plan.entry).toBeLessThan(Math.min(...h.slice(-2).map((c) => c.l)));
    expect(plan.cautions.join(" ")).toMatch(/momentum is still pushing up/);
    expect(plan.confidencePct).toBeLessThan(base.confidencePct);
    expect(base.entryType).not.toBe("stop");
  });

  it("the classic rules ignore momentum and volume", () => {
    const plan = buildPlan(hi, mid, against, h, h4, undefined, { classic: true, volumeRatio: 0.1 });
    expect(plan.entryType).not.toBe("stop");
    expect(plan.cautions.join(" ")).not.toMatch(/momentum|Volume/);
    expect(plan.verdict).toBe("trade");
  });

  it("marks light volume", () => {
    const quiet = buildPlan(hi, mid, lo, h, h4, undefined, { volumeRatio: 0.2 });
    const normal = buildPlan(hi, mid, lo, h, h4, undefined, { volumeRatio: 1 });
    expect(quiet.cautions.join(" ")).toMatch(/Volume is light \(0\.2× average\)/);
    expect(quiet.confidencePct).toBeLessThan(normal.confidencePct);
  });

  it("waits when a level blocks the way before 1.5R", () => {
    // A gentle downtrend at ~1000 (ATR 2) with one swing high 3 above
    // (the stop goes just beyond it, 3.5 away).
    const price = 1000;
    const line = (n: number): Candle[] =>
      Array.from({ length: n }, (_, i) => {
        const mid = price + 0.05 * (n - 1 - i);
        return { t: i * 3600_000, o: mid, h: mid + 1, l: mid - 1, c: mid };
      });
    const frame = (name: string): FrameRead => ({
      name,
      bias: "bearish",
      score: -2,
      close: price,
      ema20: price,
      ema50: price + 5,
      ema200: price + 10,
      rsi: 40,
      atr: 2,
      macdHist: -1,
      macdRising: false,
      adx: 30,
    });
    const withHigh = line(300);
    withHigh[290] = { ...withHigh[290], h: price + 3 };
    const clear = buildPlan(frame("Daily"), frame("4H"), frame("1H"), withHigh, line(300), price);
    expect(clear.verdict).toBe("trade");
    // The engine's stop is 3.5 away; members get 20% more room.
    expect(clear.stop).toBeCloseTo(price + 3.5 * STOP_ROOM);

    // Now a swing low 4 below: only 1.1R of room before support.
    const blocked = [...withHigh];
    blocked[280] = { ...blocked[280], l: price - 4 };
    const plan = buildPlan(frame("Daily"), frame("4H"), frame("1H"), blocked, line(300), price);
    expect(plan.verdict).toBe("wait");
    expect(plan.waitReason).toMatch(/Not enough room: the next support is only 1\.1R away/);
  });

  it("puts the second target on a real level when there is one", () => {
    const plan = buildPlan(hi, mid, lo, h, h4);
    const risk = (plan.stop - plan.entry) / STOP_ROOM;
    const tp2R = (plan.entry - plan.targets[1]) / risk;
    expect(tp2R).toBeGreaterThanOrEqual(1.5);
    expect(plan.targets[2]).toBeLessThan(plan.targets[1]);
  });

  it("waits while the gold market is shut for the weekend", () => {
    const gold = parseInstrument("gold")!;
    const saturday = Date.UTC(2026, 9, 24, 12);
    const session = sessionRead(gold, saturday);
    expect(session.closed).toMatch(/closed for the weekend/);
    const plan = buildPlan(hi, mid, lo, h, h4, undefined, { session });
    expect(plan.verdict).toBe("wait");
  });
});

describe("sessionRead", () => {
  const gold = parseInstrument("gold")!;
  const btc = parseInstrument("btc")!;
  it("knows gold's hours in UK time", () => {
    // Wednesday 2pm UK (BST): London/New York overlap, nothing to say.
    expect(sessionRead(gold, Date.UTC(2026, 9, 21, 13))).toEqual({ penalty: 0 });
    // 10pm UK: daily rollover.
    expect(sessionRead(gold, Date.UTC(2026, 9, 21, 21)).caution).toMatch(/rollover/);
    // 3am UK: Asian session.
    expect(sessionRead(gold, Date.UTC(2026, 9, 21, 2)).caution).toMatch(/Asian/);
    // Sunday 11:30pm UK (clocks went back that morning): open again.
    expect(sessionRead(gold, Date.UTC(2026, 9, 25, 23, 30)).closed).toBeUndefined();
  });
  it("only notes weekends for crypto", () => {
    expect(sessionRead(btc, Date.UTC(2026, 9, 24, 12)).caution).toMatch(/Weekend/);
    expect(sessionRead(btc, Date.UTC(2026, 9, 21, 2))).toEqual({ penalty: 0 });
  });
});

describe("framesFor", () => {
  it("picks 4H/1H/15M for a scalp and falls back from a short weekly", () => {
    const sets = {
      daily: series(100, 1000, 1, 24),
      hourly: series(1000, 1000, 0.5),
      fifteen: series(500, 1000, 0.1, 0.25),
      five: series(500, 1000, 0.02, 5 / 60),
      minute: [],
    };
    expect(framesFor(sets, "scalp").frames.map((f) => f?.name)).toEqual(["4H", "1H", "15M"]);
    expect(framesFor(sets, "swing").frames.map((f) => f?.name)).toEqual(["Daily", "4H", "1H"]);
    const five = framesFor(sets, "scalp", "5m");
    expect(five.frames.map((f) => f?.name)).toEqual(["1H", "15M", "5M"]);
    expect(five.entryCandles).toBe(sets.five);
  });

  it("spots 1- and 5-minute requests, but not 15-minute ones", () => {
    expect(fastFrame("XAUUSD signal 5m")).toBe("5m");
    expect(fastFrame("btc m5 scalp")).toBe("5m");
    expect(fastFrame("gold 1m")).toBe("1m");
    expect(fastFrame("gold 15m")).toBeUndefined();
    expect(fastFrame("gold signal")).toBeUndefined();
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

describe("scaleTargets (Quick Scalp, Potentially, Greedy Runner)", () => {
  it("BUY: 80% of TP1, 60% of the way TP1→TP2, 85% of the way TP2→TP3", () => {
    const [q, p, g] = scaleTargets("BUY", 100, [110, 120, 140], 0.01);
    expect(q).toBeCloseTo(108);
    expect(p).toBeCloseTo(116);
    expect(g).toBeCloseTo(137);
    expect(100 < q && q < p && p < g).toBe(true);
  });
  it("SELL mirrors it", () => {
    const [q, p, g] = scaleTargets("SELL", 100, [90, 80, 60], 0.01);
    expect(q).toBeCloseTo(92);
    expect(p).toBeCloseTo(84);
    expect(g).toBeCloseTo(63);
    expect(100 > q && q > p && p > g).toBe(true);
  });
  it("stays strictly in order even when the engine's levels bunch up or cross", () => {
    for (const [dir, t] of [
      ["BUY", [110, 110, 110]],
      ["BUY", [110, 105, 103]],
      ["SELL", [90, 90, 95]],
      ["BUY", [100, 100, 100]],
    ] as const) {
      const [q, p, g] = scaleTargets(dir, 100, [...t] as [number, number, number], 0.5);
      const s = dir === "BUY" ? 1 : -1;
      expect((q - 100) * s).toBeGreaterThanOrEqual(0.5);
      expect((p - q) * s).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect((g - p) * s).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });
});

describe("isAnyMarketAsk", () => {
  it("catches signal asks that name no market", () => {
    for (const t of [
      "Whats a good trade right now",
      "That means give me signal",
      "signal?",
      "any setups",
      "what should i buy",
      "need a scalp",
    ])
      expect(isAnyMarketAsk(t), t).toBe(true);
  });
  it("leaves named markets and ordinary chat alone", () => {
    for (const t of [
      "Btc signal",
      "my phone has no signal",
      "suck ur dad",
      "you trade insults like a toddler",
      "",
    ])
      expect(isAnyMarketAsk(t), t).toBe(false);
  });
});

describe("volatilityRatio and ukBlock", () => {
  it("compares how lively the chart is now with its last 100 candles", async () => {
    const { volatilityRatio } = await import("./trade-signal");
    const candle = (i: number, size: number) => ({
      t: i * 300_000,
      o: 100,
      h: 100 + size,
      l: 100 - size,
      c: 100,
    });
    const cs = [
      ...Array.from({ length: 90 }, (_, i) => candle(i, 1)),
      ...Array.from({ length: 15 }, (_, i) => candle(90 + i, 0.25)),
    ];
    const r = volatilityRatio(cs);
    expect(r).toBeGreaterThan(0.2);
    expect(r).toBeLessThan(0.5);
    expect(volatilityRatio(cs.slice(0, 50))).toBeNaN();
  });
  it("puts a moment in its UK 4-hour block, summer time included", async () => {
    const { ukBlock } = await import("./trade-signal");
    expect(ukBlock(Date.parse("2026-12-02T03:59:00Z"))).toBe(0);
    expect(ukBlock(Date.parse("2026-12-02T08:30:00Z"))).toBe(2);
    // 23:30 UTC in July is 00:30 UK.
    expect(ukBlock(Date.parse("2026-07-14T23:30:00Z"))).toBe(0);
  });
});
