import { describe, expect, it } from "vitest";
import {
  adx,
  cryptoFlowRead,
  newsCurrencies,
  newsRisk,
  parseBinanceTicker,
  parseCalendar,
  parseFunding,
  parseKrakenTicker,
  parseOpenInterestChange,
  parseYahooPrice,
  volumeRatio,
} from "./trade-signal-extras";

const trend = (n: number, step: number) =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step;
    return { t: i, o: c - step / 2, h: c + 0.5, l: c - 0.5, c };
  });
const zigzag = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + (i % 2 ? 1 : -1);
    return { t: i, o: 100, h: c + 0.6, l: c - 0.6, c };
  });

describe("trend strength", () => {
  it("is high in a steady trend and low in a back-and-forth market", () => {
    expect(adx(trend(80, 1))).toBeGreaterThan(40);
    expect(adx(zigzag(80))).toBeLessThan(20);
  });
  it("needs enough candles", () => {
    expect(adx(trend(20, 1))).toBeNaN();
  });
});

describe("volume", () => {
  it("compares the latest candles with the ones before", () => {
    const cs = Array.from({ length: 23 }, (_, i) => ({
      t: i,
      o: 1,
      h: 1,
      l: 1,
      c: 1,
      v: i >= 20 ? 30 : 10,
    }));
    expect(volumeRatio(cs)).toBeCloseTo(3);
    expect(volumeRatio(cs.map(({ v: _v, ...c }) => c))).toBeNaN();
  });
});

describe("economic calendar", () => {
  const ukTime = (d: Date) => d.toISOString().slice(11, 16);
  const feed = [
    {
      title: "Non-Farm Employment Change",
      country: "USD",
      date: "2026-10-30T08:30:00-04:00",
      impact: "High",
    },
    { title: "CPI y/y", country: "GBP", date: "2026-10-30T07:00:00+01:00", impact: "High" },
    { title: "Bank Holiday", country: "JPY", date: "2026-10-30T00:00:00+09:00", impact: "Holiday" },
    { title: "broken", country: "USD", date: "not a date", impact: "High" },
  ];
  const events = parseCalendar(feed);
  const nfp = Date.parse("2026-10-30T12:30:00Z");

  it("reads the feed and skips broken rows", () => {
    expect(events).toHaveLength(3);
    expect(parseCalendar(null)).toEqual([]);
  });

  it("matches news to the market's currencies", () => {
    expect(newsCurrencies({ label: "", code: "GBPJPY", asset: "forex" })).toEqual(["GBP", "JPY"]);
    expect(newsCurrencies({ label: "", code: "UK100", asset: "index" })).toEqual(["GBP"]);
    expect(newsCurrencies({ label: "", code: "XAUUSD", asset: "metal" })).toEqual(["USD"]);
  });

  it("warns when big news is close, and lists it when it's later in the signal", () => {
    const gold = { label: "Gold", code: "XAUUSD", asset: "metal" as const };
    const soon = newsRisk(events, gold, nfp - 20 * 60_000, nfp + 3600_000, ukTime);
    expect(soon.events.map((e) => e.title)).toEqual(["Non-Farm Employment Change"]);
    expect(soon.caution).toContain("USD Non-Farm Employment Change at 12:30");
    const later = newsRisk(events, gold, nfp - 2 * 3600_000, nfp + 3600_000, ukTime);
    expect(later.events).toHaveLength(1);
    expect(later.caution).toBeUndefined();
    const after = newsRisk(events, gold, nfp + 2 * 3600_000, nfp + 5 * 3600_000, ukTime);
    expect(after.events).toHaveLength(0);
  });
});

describe("crypto positioning", () => {
  it("reads funding and open interest", () => {
    expect(parseFunding({ lastFundingRate: "0.00010000" })).toBeCloseTo(0.0001);
    expect(
      parseOpenInterestChange([{ sumOpenInterest: "100" }, { sumOpenInterest: "103" }]),
    ).toBeCloseTo(0.03);
    expect(parseOpenInterestChange([])).toBeNaN();
  });
  it("flags a crowded trade in the signal's direction only", () => {
    const hot = { funding: 0.0008, oiChange24h: 0.05 };
    expect(cryptoFlowRead(hot, "BUY").caution).toContain("crowded long");
    expect(cryptoFlowRead(hot, "SELL").caution).toBeUndefined();
    expect(cryptoFlowRead(hot, "BUY").note).toBe(
      "funding +0.080% (longs paying shorts), open interest +5.0% in 24h",
    );
  });
});

describe("live price", () => {
  it("reads each feed's ticker format", () => {
    expect(parseBinanceTicker({ symbol: "BTCUSDT", price: "67123.45" })).toBe(67123.45);
    expect(parseKrakenTicker({ error: [], result: { PAXGUSD: { c: ["2650.10", "0.1"] } } })).toBe(
      2650.1,
    );
    expect(parseYahooPrice({ chart: { result: [{ meta: { regularMarketPrice: 1.0832 } }] } })).toBe(
      1.0832,
    );
    expect(parseBinanceTicker({})).toBeNaN();
  });
});
