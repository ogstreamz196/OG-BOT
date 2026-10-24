import { describe, expect, it } from "vitest";
import {
  calibrationLine,
  fetchBinanceHistory,
  historyNeeded,
  parseSavedBacktest,
  runBacktest,
  summarise,
  tradeR,
  type SavedBacktest,
} from "./trade-signal-backtest";
import type { Candle } from "./trade-signal";

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 0, 1);

/** A wavy trend so there are swings, pullbacks and both kinds of outcome. */
function series(n: number, ms: number, start: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + step * i + Math.sin(i / 5) * 12 + Math.sin(i / 37) * 30;
    return { t: T0 + i * ms, o: mid, h: mid + 3, l: mid - 3, c: mid + Math.cos(i / 5), v: 100 };
  });
}

describe("tradeR", () => {
  const plan = { direction: "BUY" as const, entry: 100, stop: 95, targets: [105, 110, 120] };
  it("scores each way a trade can end", () => {
    expect(tradeR(plan, "stopped", 0, NaN)).toBe(-1);
    // A third at TP1 (1R), the rest back at entry.
    expect(tradeR(plan, "breakeven", 1, NaN)).toBeCloseTo(1 / 3);
    // Thirds at 1R, 2R and 4R.
    expect(tradeR(plan, "tp3", 3, NaN)).toBeCloseTo(7 / 3);
    // Time up with nothing hit: closed at the last price (+0.4R).
    expect(tradeR(plan, "expired", 0, 102)).toBeCloseTo(0.4);
    // Time up after TP1: the rest never counts below entry.
    expect(tradeR(plan, "expired", 1, 90)).toBeCloseTo(1 / 3);
    const sell = { ...plan, direction: "SELL" as const, stop: 105, targets: [95, 90, 85] };
    expect(tradeR(sell, "tp1", 1, 96)).toBeCloseTo(1 / 3);
  });
});

describe("runBacktest", () => {
  const sets = {
    daily: series(500, 24 * HOUR, 1000, 2).map((c) => ({ ...c, t: c.t - 400 * 24 * HOUR })),
    hourly: series(3000, HOUR, 1500, 0.3),
    fifteen: [],
    minute: [],
  };
  const from = T0 + 1200 * HOUR;
  const to = T0 + 2800 * HOUR;

  it("only uses candles that had closed, and follows each signal to the end", async () => {
    const trades = await runBacktest({ sets, frame: "1H", from, to });
    expect(trades.length).toBeGreaterThan(100);
    for (const t of trades) {
      expect(t.t).toBeGreaterThan(from);
      expect(["tp1", "tp2", "tp3", "stopped", "breakeven", "expired", "unfilled"]).toContain(
        t.status,
      );
      if (!t.entered) expect(t.r).toBe(0);
    }
    const s = summarise(trades);
    expect(s.signals).toBe(trades.length);
    expect(s.filled).toBeLessThanOrEqual(s.taken);
    expect(s.bands.High.n + s.bands.Medium.n + s.bands.Low.n).toBe(s.filled);
  });

  it("runs the classic rules too, for comparison", async () => {
    const classic = await runBacktest({ sets, frame: "1H", from, to, classic: true });
    expect(classic.every((t) => t.verdict === "trade" && t.entryType !== "stop")).toBe(true);
  });
});

describe("saved results on live cards", () => {
  const saved: SavedBacktest = {
    v: 1,
    market: "BTCUSD",
    frame: "15M",
    days: 90,
    to: T0,
    filled: 150,
    tp1: 90,
    avgR: 0.21,
    bands: { High: { n: 40, tp1: 28 }, Medium: { n: 80, tp1: 46 }, Low: { n: 5, tp1: 1 } },
  };
  it("quotes the band when it has enough trades, else the overall rate", () => {
    expect(calibrationLine(saved, "High")).toBe(
      "Backtest, 90 days: High-confidence signals hit TP1 70% of the time (40 trades)",
    );
    expect(calibrationLine(saved, "Low")).toBe(
      "Backtest, 90 days: Signals like this hit TP1 60% of the time (150 trades)",
    );
    expect(calibrationLine({ ...saved, filled: 10 }, "Low")).toBeNull();
    expect(calibrationLine(null, "High")).toBeNull();
  });
  it("reads only valid saved results", () => {
    expect(parseSavedBacktest(JSON.stringify(saved))).toEqual(saved);
    expect(parseSavedBacktest("not json")).toBeNull();
    expect(parseSavedBacktest(JSON.stringify({ v: 2 }))).toBeNull();
  });
});

describe("history download", () => {
  it("pages through Binance 1000 candles at a time", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const start = Number(new URL(url).searchParams.get("startTime"));
      const end = Number(new URL(url).searchParams.get("endTime"));
      const rows: unknown[][] = [];
      for (let t = start; t <= end && rows.length < 1000; t += HOUR)
        rows.push([t, "1", "2", "0.5", "1.5", "10"]);
      return new Response(JSON.stringify(rows));
    }) as unknown as typeof fetch;
    const out = await fetchBinanceHistory("BTCUSDT", "hourly", T0, T0 + 2500 * HOUR, fake);
    expect(out).toHaveLength(2501);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("data-api.binance.vision");
    expect(out[1].t - out[0].t).toBe(HOUR);
  });
  it("moves to Binance's main API when the mirror refuses", async () => {
    const hosts: string[] = [];
    const fake = (async (url: string) => {
      hosts.push(new URL(url).host);
      if (url.includes("binance.vision")) return new Response("blocked", { status: 451 });
      return new Response(JSON.stringify([[T0, "1", "2", "0.5", "1.5", "10"]]));
    }) as unknown as typeof fetch;
    const out = await fetchBinanceHistory("BTCUSDT", "hourly", T0, T0 + HOUR / 2, fake);
    expect(out).toHaveLength(1);
    expect(hosts).toEqual(["data-api.binance.vision", "api.binance.com"]);
  });

  it("asks for enough warm-up history", () => {
    const end = T0 + 100 * 24 * HOUR;
    const { start, need } = historyNeeded("15M", 30, end);
    expect(start).toBe(end - 30 * 24 * HOUR);
    expect(need.fifteen).toBe(start - 500 * 15 * 60_000);
    expect(need.minute).toBeUndefined();
  });
});
