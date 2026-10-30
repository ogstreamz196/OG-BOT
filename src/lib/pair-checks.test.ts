import { describe, expect, it } from "vitest";
import {
  CHECK_BONUS,
  CHECK_PENALTY,
  adjustConfidence,
  dollarRead,
  flowRead,
  flowVerdict,
  goldVerdict,
} from "./pair-checks";
import { ukSession } from "./trade-signal";
import { buildReport, type LiveRow } from "./signal-report.server";

// Live-trial pair checks: gold against the US dollar, bitcoin against who's
// hitting the market, and weekends as their own session.

const HOUR = 3_600_000;
const series = (from: number, to: number, n = 6) =>
  Array.from({ length: n }, (_, i) => {
    const c = from + ((to - from) * i) / (n - 1);
    return { t: i * HOUR, o: c, h: c, l: c, c };
  });

describe("dollarRead", () => {
  it("EUR/USD falling (and yields rising) is the dollar strengthening, against a gold buy", () => {
    const d = dollarRead(series(1.1, 1.097), series(4.2, 4.3))!;
    expect(d.dollar).toBe("up");
    expect(d.note).toMatch(
      /EUR\/USD −?-0\.\d+% over 4 hours, US 10-year yield \+\d\.\d%: the dollar's strengthening/,
    );
    expect(goldVerdict("BUY", d.dollar)).toBe("against");
    expect(goldVerdict("SELL", d.dollar)).toBe("with");
  });
  it("EUR/USD rising is the dollar weakening; small moves are steady; no data, no read", () => {
    expect(dollarRead(series(1.097, 1.1), [])!.dollar).toBe("down");
    expect(dollarRead(series(1.1, 1.1001), series(4.2, 4.2))!.dollar).toBe("flat");
    // The two disagree: steady.
    expect(dollarRead(series(1.1, 1.097), series(4.3, 4.2))!.dollar).toBe("flat");
    expect(dollarRead([], [])).toBeNull();
    expect(goldVerdict("BUY", "flat")).toBe("flat");
  });
});

describe("flowRead", () => {
  const candle = (v: number, tb: number) => ({ t: 0, o: 1, h: 1, l: 1, c: 1, v, tb });
  it("the share of volume that was aggressive buying", () => {
    const buyers = flowRead([candle(10, 7), candle(10, 6), candle(10, 6)])!;
    expect(buyers.buyShare).toBeCloseTo(19 / 30, 6);
    expect(buyers.note).toMatch(/63% of volume was aggressive buying \(buyers in control\)/);
    expect(flowVerdict("BUY", buyers.buyShare)).toBe("with");
    expect(flowVerdict("SELL", buyers.buyShare)).toBe("against");
    expect(flowVerdict("BUY", 0.5)).toBe("flat");
    expect(flowVerdict("SELL", 0.4)).toBe("with");
  });
  it("no taker volume from the feed, no read", () => {
    expect(
      flowRead([{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 5 }, candle(1, 1), candle(1, 1)]),
    ).toBeNull();
    expect(flowRead([candle(1, 1)])).toBeNull();
  });
});

describe("adjustConfidence", () => {
  it("a check with it adds a little, one against takes more off, inside 0–90", () => {
    expect(adjustConfidence(70, ["with"])).toBe(70 + CHECK_BONUS);
    expect(adjustConfidence(70, ["against"])).toBe(70 - CHECK_PENALTY);
    expect(adjustConfidence(70, ["with", "against", "flat"])).toBe(
      70 + CHECK_BONUS - CHECK_PENALTY,
    );
    expect(adjustConfidence(89, ["with", "with"])).toBe(90);
  });
});

describe("weekend session", () => {
  it("Saturday and Sunday (UK) are their own session", () => {
    expect(ukSession(Date.parse("2026-11-07T10:00:00Z"))).toBe("weekend");
    expect(ukSession(Date.parse("2026-11-08T23:30:00Z"))).toBe("weekend");
    expect(ukSession(Date.parse("2026-11-09T00:30:00Z"))).toBe("asia");
  });
});

describe("report: by pair check", () => {
  it("groups finished signals by what the checks said", () => {
    const row = (over: Partial<LiveRow>): LiveRow => ({
      market: "BTCUSD",
      label: "BTC/USD",
      direction: "BUY",
      entry: 100,
      stop: 95,
      tp1: 104,
      tp2: 104,
      tp3: 104,
      pip: null,
      decimals: 2,
      status: "tp3",
      best_target: 3,
      confidence_pct: 74,
      created_at: "2026-11-04T10:00:00Z",
      feeds: { checks: { flow: "with" } },
      ...over,
    });
    const r = buildReport(
      [
        row({}),
        row({
          entry: 110,
          stop: 105,
          status: "stopped",
          best_target: 0,
          feeds: { checks: { flow: "against" } },
        }),
      ],
      null,
      30,
    );
    expect(r.markets[0].byCheck.map((c) => [c.label, c.wins, c.losses])).toEqual([
      ["Order flow with it", 1, 0],
      ["Order flow against it", 0, 1],
    ]);
  });
});
