import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIGNAL_DISCLAIMERS,
  MARKET_SHUT_LINE,
  NO_SIGNAL_LINES,
  buildTradeSignalContext,
  buildTradeSignal,
  plainForTelegram,
  tradeReplyTtlMs,
} from "./trade-signal-context.server";

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 0, 1);

function bars(n: number, start: number, step: number, ms: number) {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + step * i + Math.sin(i / 3) * Math.abs(step) * 4;
    return {
      t: T0 + i * ms,
      o: mid,
      h: mid + Math.abs(step) * 2,
      l: mid - Math.abs(step) * 2,
      c: mid,
    };
  });
}

const binanceRows = (b: ReturnType<typeof bars>) =>
  b.map((x) => [
    x.t,
    String(x.o),
    String(x.h),
    String(x.l),
    String(x.c),
    "1",
    x.t + 1,
    "0",
    1,
    "0",
    "0",
    "0",
  ]);

const yahooChart = (b: ReturnType<typeof bars>) => ({
  chart: {
    result: [
      {
        timestamp: b.map((x) => x.t / 1000),
        indicators: {
          quote: [
            {
              open: b.map((x) => x.o),
              high: b.map((x) => x.h),
              low: b.map((x) => x.l),
              close: b.map((x) => x.c),
            },
          ],
        },
      },
    ],
  },
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const realFetch = globalThis.fetch;
/** Swaps in a fake fetch (works under both Vitest and Bun's test runner). */
function stubFetch(fn: unknown) {
  globalThis.fetch = fn as typeof fetch;
}
// A weekday afternoon in London, so market hours never turn a test into
// "wait". Date.now is pinned by hand so this works under Bun's runner too.
const realNow = Date.now;
const setNow = (iso: string) => {
  const t = Date.parse(iso);
  Date.now = () => t;
};
beforeEach(() => setNow("2026-10-21T13:00:00Z"));
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

describe("buildTradeSignalContext", () => {
  it("returns nothing for ordinary chat", async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy);
    expect(await buildTradeSignalContext("how are you mate")).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds a signal card for crypto from Binance", async () => {
    stubFetch(
      vi.fn(async (url: string) => {
        if (url.includes("binance") && url.includes("interval=1d"))
          return ok(binanceRows(bars(365, 40000, 100, 24 * HOUR)));
        if (url.includes("binance") && url.includes("interval=1h"))
          return ok(binanceRows(bars(1000, 70000, 10, HOUR)));
        return new Response("nope", { status: 404 });
      }),
    );
    const out = await buildTradeSignalContext("BTC signal please");
    expect(out).toContain("TRADE SIGNAL MODE");
    expect(out).toContain("LIVE MARKET DATA — BTC/USD (Bitcoin)");
    expect(out).toContain("source: Binance");
    expect(out).toContain("Direction: BUY");
    expect(out).toMatch(/Stop loss: \d/);
    expect(out).toMatch(/Take profit: \d[\d.]* \(one target\)/);
    expect(out).toMatch(/Confidence: \d{2}% \((Low|Medium|High)\)/);
    expect(out).toMatch(/Valid until: .+ UK time \(intraday signal, good for 4 hours\)/);
    const signal = await buildTradeSignal("BTC signal please");
    const entry = out.match(/\nEntry: ([\d.]+)/)?.[1];
    const stop = out.match(/\nStop loss: ([\d.]+)/)?.[1];
    expect(entry).toBeDefined();
    expect(stop).toBeDefined();
    if (!entry || !stop) throw new Error("signal levels missing");
    // OG Trade Bot taking the trade, plainly: in at, stop loss, one take profit.
    expect(signal.reply).toMatch(
      new RegExp(
        `^(🟢 I'm gonna buy|🔴 I'm gonna sell) ₿ BTC/USD (now at|at|if it breaks (above|below)) ${entry.replace(".", "\\.")}( on a pullback)?\\n🛑 My stop loss will be ${stop.replace(".", "\\.")} · −\\$[\\d,.]+\\n🎯 I'll take profit at [\\d.]+ · \\+\\$[\\d,.]+\\n🔒 At [\\d.]+ \\(70% of the way\\) my stop moves to [\\d.]+, locking in profit\\n\\n⏱ 1H · 💪 (5[1-9]|[6-8]\\d|90)%`,
      ),
    );
    // The stop loss with what 0.5 lot loses there (bitcoin: $1 a lot per $1).
    const loss = Number(signal.reply.match(/ · −\$([\d,.]+)\n/)?.[1].replace(/,/g, ""));
    expect(Math.abs(loss - Math.abs(Number(entry) - Number(stop)) * 0.5)).toBeLessThan(0.011);
    // No trend, exit, expiry or sign-off lines.
    expect(signal.reply).not.toMatch(/📊|❌|⏳|📚|Quick Scalp|Little Brave|Greedy/);
    // One take profit: every tracked target is on it.
    expect(new Set(signal.plan!.targets).size).toBe(1);
    // The desk may move the take profit, only inside the safe band around TP1.
    const band = signal.tpRange!;
    expect(band.lo).toBeLessThan(band.quick);
    expect(band.quick).toBeLessThan(band.hi);
    expect(signal.plan!.targets[0]).toBe(band.quick);
    const moved = signal.retarget!(band.hi - 0.004);
    expect(moved.plan.targets).toEqual(
      [band.hi, band.hi, band.hi].map((n) => Number((n - 0.004).toFixed(2))),
    );
    expect(moved.reply).toContain(`🎯 I'll take profit at ${moved.plan.targets[0].toFixed(2)}`);
    // What's followed is exactly what's shown: every level is the printed number.
    const plan = signal.plan!;
    for (const lvl of [plan.entry, plan.stop, ...plan.targets])
      expect(signal.reply).toContain(lvl.toFixed(plan.decimals));
    for (const lvl of [plan.entry, plan.stop, ...plan.targets])
      expect(Number(lvl.toFixed(plan.decimals))).toBe(lvl);
    // Members never hear about the AI desk.
    expect(signal.reply).not.toMatch(/\bAIs?\b|DESK/);
    expect(signal.reply).not.toMatch(/TP\d|SL:/);
    // No @handles (mentions are entities).
    expect(signal.reply).not.toContain("@");
    expect(new Set(SIGNAL_DISCLAIMERS).size).toBeGreaterThan(4);
    expect(signal.expiresAt).not.toBeNull();
  });

  it("falls back to Kraken when Binance is blocked", async () => {
    const krak = (b: ReturnType<typeof bars>) => ({
      error: [],
      result: {
        XETHZUSD: b.map((x) => [
          x.t / 1000,
          String(x.o),
          String(x.h),
          String(x.l),
          String(x.c),
          "0",
          "1",
          1,
        ]),
        last: 1,
      },
    });
    stubFetch(
      vi.fn(async (url: string) => {
        if (url.includes("binance")) return new Response("restricted", { status: 451 });
        if (url.includes("kraken") && url.includes("interval=1440"))
          return ok(krak(bars(365, 4000, -5, 24 * HOUR)));
        if (url.includes("kraken") && url.includes("interval=60"))
          return ok(krak(bars(720, 3000, -1, HOUR)));
        return new Response("nope", { status: 404 });
      }),
    );
    const out = await buildTradeSignalContext("eth short?");
    expect(out).toContain("source: Kraken");
    expect(out).toContain("Direction: SELL");
  });

  it("quotes forex in pips with 5 decimals from Yahoo", async () => {
    stubFetch(
      vi.fn(async (url: string) => {
        if (url.includes("yahoo") && url.includes("interval=1d"))
          return ok(yahooChart(bars(260, 1.0, 0.001, 24 * HOUR)));
        if (url.includes("yahoo") && url.includes("interval=1h"))
          return ok(yahooChart(bars(1000, 1.1, 0.00005, HOUR)));
        return new Response("nope", { status: 404 });
      }),
    );
    const out = await buildTradeSignalContext("gbpusd signal");
    expect(out).toContain("LIVE MARKET DATA — GBP/USD");
    expect(out).toMatch(/Price now: \d\.\d{5}/);
    expect(out).toMatch(/Stop loss: \d\.\d{5} \(\d+ pips\)/);
  });

  it("starts the backup source when the first is slow", async () => {
    const krak = (b: ReturnType<typeof bars>) => ({
      error: [],
      result: {
        XLTCZUSD: b.map((x) => [
          x.t / 1000,
          String(x.o),
          String(x.h),
          String(x.l),
          String(x.c),
          "0",
          "1",
          1,
        ]),
        last: 1,
      },
    });
    stubFetch(
      vi.fn(async (url: string) => {
        if (url.includes("binance")) {
          await new Promise((r) => setTimeout(r, 3000));
          return new Response("slow", { status: 504 });
        }
        if (url.includes("kraken") && url.includes("interval=1440"))
          return ok(krak(bars(365, 80, 0.5, 24 * HOUR)));
        if (url.includes("kraken") && url.includes("interval=60"))
          return ok(krak(bars(720, 100, 0.05, HOUR)));
        return new Response("nope", { status: 404 });
      }),
    );
    const started = Date.now();
    const out = await buildTradeSignalContext("ltc signal");
    expect(out).toContain("source: Kraken");
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("adds the top Yahoo Finance headlines, and carries on without them", async () => {
    const feed = (withNews: boolean) =>
      vi.fn(async (url: string) => {
        if (url.includes("finance/search")) {
          return withNews
            ? ok({
                news: [
                  {
                    title: "Gold climbs as dollar slips",
                    publisher: "Reuters",
                    providerPublishTime: 1767225600,
                  },
                  { title: "Fed speakers in focus", publisher: "Bloomberg" },
                ],
              })
            : new Response("blocked", { status: 403 });
        }
        if (url.includes("interval=1d"))
          return ok(
            url.includes("binance")
              ? binanceRows(bars(365, 2000, 2, 24 * HOUR))
              : yahooChart(bars(365, 2000, 2, 24 * HOUR)),
          );
        if (url.includes("interval=1h"))
          return ok(
            url.includes("binance")
              ? binanceRows(bars(1000, 2600, 0.2, HOUR))
              : yahooChart(bars(1000, 2600, 0.2, HOUR)),
          );
        return new Response("nope", { status: 404 });
      });
    stubFetch(feed(true));
    const out = await buildTradeSignalContext("nas100 signal");
    expect(out).toContain("MARKET HEADLINES (Yahoo Finance");
    expect(out).toContain("1. Gold climbs as dollar slips, Reuters (2026-01-01 00:00 UTC)");
    expect(out).toContain("2. Fed speakers in focus, Bloomberg");

    stubFetch(feed(false));
    const quiet = await buildTradeSignalContext("xagusd signal");
    expect(quiet).toContain("Direction:");
    expect(quiet).not.toContain("MARKET HEADLINES");
  });

  it("refuses to invent levels when no feed answers", async () => {
    stubFetch(vi.fn(async () => new Response("down", { status: 503 })));
    const out = await buildTradeSignalContext("usdcad entry");
    expect(out).toContain("could not be loaded");
    expect(out).not.toContain("SIGNAL ENGINE");
    const signal = await buildTradeSignal("usdcad entry");
    expect(signal.expiresAt).toBeNull();
    expect(signal.reply).not.toMatch(/getting in|stop loss|Quick Scalp/);
  });
});

describe("gold is back (the Boss, 2026-11-07)", () => {
  it("a gold ask is no longer blocked: it reaches for the real price feed", async () => {
    const fetchSpy = vi.fn(async () => new Response("unused", { status: 500 }));
    stubFetch(fetchSpy);
    const { RETIRED_REPLY } = await import("./signal-markets");
    const signal = await buildTradeSignal("gold signal");
    // Not the retired line any more, and it actually goes for the gold feed.
    expect(signal.reply).not.toBe(RETIRED_REPLY);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("an ask naming no market goes to bitcoin", async () => {
    const { bestMarketAsk } = await import("./trade-signal-context.server");
    expect(await bestMarketAsk("give me a signal")).toBe("BTCUSD signal give me a signal");
  });
});

describe("Telegram delivery", () => {
  for (const pair of ["BTCUSD"]) {
    for (const frame of ["1h", "15m", "5m", "1m"]) {
      it(`calculates ${pair} from actual ${frame} entry candles`, async () => {
        // Isolate source/candle/card caches so every selection must fetch its feed.
        vi.resetModules();
        const { buildTradeSignal: build, ONE_MINUTE_MIN_CONFIDENCE } =
          await import("./trade-signal-context.server");
        const fetchSpy = vi.fn(async (url: string) => {
          const interval = new URL(url).searchParams.get("interval");
          // Gold's real spot price, a few dollars over the gold token.
          if (url.includes("swissquote"))
            return ok([{ spreadProfilePrices: [{ bid: 2204.9, ask: 2205.1 }] }]);
          if (!url.includes("binance")) return new Response("nope", { status: 404 });
          const ms =
            interval === "1d"
              ? 24 * HOUR
              : interval === "1h"
                ? HOUR
                : interval === "15m"
                  ? HOUR / 4
                  : interval === "5m"
                    ? 300_000
                    : 60_000;
          return ok(binanceRows(bars(1000, 2000, interval === "1m" ? -0.1 : 0.2, ms)));
        });
        stubFetch(fetchSpy);
        const signal = await build(`${pair} signal ${frame}`);
        expect(fetchSpy.mock.calls.some(([url]) => url.includes(`interval=${frame}&`))).toBe(true);
        // 1-minute reads under the higher bar are a wait.
        if (frame === "1m" && signal.summary!.confidencePct < ONE_MINUTE_MIN_CONFIDENCE) {
          expect(signal.reply).toMatch(/^⏸ No signal · .+ · 1M\n/);
          expect(signal.plan).toBeUndefined();
        } else {
          expect(signal.reply).toContain(`\n⏱ ${frame.toUpperCase()} · 💪 `);
          expect(signal.reply).toMatch(/^(🟢|🔴) I'm gonna (buy|sell) \D*\d[\d.]*/);
        }
        expect(signal.expiresAt).not.toBeNull();
        if (frame === "1m") {
          // Worked out from the 1-minute candles, not the 15-minute ones.
          const fifteen = await build(`${pair} signal 15m`);
          expect(fifteen.reply).toContain("\n⏱ 15M · 💪 ");
          expect(signal.summary!.entry).not.toBe(fifteen.summary!.entry);
        }
      });
    }
  }

  it("self-destructs one clean-up sweep before the signal expires", () => {
    const H = 3600_000;
    const SWEEP = 5 * 60_000;
    expect(tradeReplyTtlMs("gold scalp")).toBe(1 * H - SWEEP);
    expect(tradeReplyTtlMs("eurusd signal")).toBe(4 * H - SWEEP);
    expect(tradeReplyTtlMs("btc swing")).toBe(24 * H - SWEEP);
  });

  it("strips markdown emphasis that Telegram would show as asterisks", () => {
    expect(plainForTelegram("## Setup\n**Entry:** 1.08500")).toBe("Setup\nEntry: 1.08500");
  });
});
