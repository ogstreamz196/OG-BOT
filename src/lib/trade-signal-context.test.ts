import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTradeSignalContext,
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
afterEach(() => {
  globalThis.fetch = realFetch;
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
    expect(out).toMatch(/TP1: \d.*TP2: \d.*TP3: \d/);
    expect(out).toMatch(/Confidence: \d{2}% \((Low|Medium|High)\)/);
    expect(out).toMatch(/Valid until: .+ UK time \(intraday signal, good for 4 hours\)/);
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
    const out = await buildTradeSignalContext("xauusd signal");
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
  });
});

describe("Telegram delivery", () => {
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
