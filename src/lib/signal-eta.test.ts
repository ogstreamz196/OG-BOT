import { describe, expect, it } from "vitest";
import { etaFromHistory, etaLine, etaText, waitingFor } from "./signal-eta.server";

const HOUR = 3600_000;
const now = Date.parse("2026-11-03T12:02:00Z");

describe("when to expect the next signal", () => {
  it("estimates from how often signals came at this time of day", () => {
    // Over the last week, about 2 signals an hour every hour.
    const times = Array.from({ length: 7 * 24 * 2 }, (_, i) => now - (i + 1) * 30 * 60_000);
    const eta = etaFromHistory(times, now, 5)!;
    expect(eta.lo).toBeLessThan(eta.mid);
    expect(eta.mid).toBeLessThanOrEqual(eta.hi);
    // Median wait at 2 an hour ≈ 21 minutes.
    expect(eta.mid).toBeGreaterThanOrEqual(15);
    expect(eta.mid).toBeLessThanOrEqual(30);
    expect(etaText(eta)).toMatch(/^about \d+–\d+ min$/);
  });

  it("never sooner than the chart's next candle closes", () => {
    const times = Array.from({ length: 7 * 24 * 20 }, (_, i) => now - (i + 1) * 3 * 60_000);
    // 1-hour chart at 12:02: the candle closes at 13:00.
    expect(etaFromHistory(times, now, 60)!.lo).toBeGreaterThanOrEqual(58);
  });

  it("knows when signals come at certain hours only", () => {
    // Only between 14:00 and 15:00 UTC each day: from 12:02, about two hours away.
    const times: number[] = [];
    for (let d = 1; d <= 7; d++)
      for (let k = 0; k < 3; k++)
        times.push(Date.parse("2026-11-03T14:10:00Z") - d * 24 * HOUR + k * 600_000);
    const eta = etaFromHistory(times, now, 5)!;
    expect(eta.lo).toBeGreaterThanOrEqual(115);
    expect(etaText(eta)).toMatch(/hours/);
  });

  it("no estimate without enough history, never a guess", () => {
    expect(etaFromHistory([now - HOUR, now - 2 * HOUR], now, 5)).toBeNull();
    expect(etaFromHistory([], now, 5)).toBeNull();
  });

  it("says what it's waiting for in plain words", () => {
    expect(
      waitingFor("The timeframes disagree and short-term momentum is against the trade."),
    ).toBe("the charts to line up");
    expect(waitingFor("No real trend right now")).toBe("a proper trend");
    expect(waitingFor(undefined)).toBe("a clean setup");
    expect(etaLine("Too quiet to trade", { lo: 20, mid: 30, hi: 55 })).toBe(
      "⏳ Waiting for the market to wake up · next signal likely in about 20–55 min",
    );
    expect(etaLine("Too quiet to trade", null)).toBe("⏳ Waiting for the market to wake up");
  });
});
