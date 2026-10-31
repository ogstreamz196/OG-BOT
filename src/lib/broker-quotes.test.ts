import { describe, expect, it } from "vitest";
import {
  addReading,
  latestSpread,
  parseSpreads,
  typicalSpread,
  weekHour,
} from "./broker-quotes.server";
import { advanceSignal, brokerLevels } from "./trade-signal-outcome";

// Vantage's spread, measured each minute and remembered per hour of the week,
// and trades judged on its bid and ask rather than the mid.

const MON_2PM = Date.parse("2026-11-02T14:10:00Z"); // 14:10 UK (winter)

describe("the spread model", () => {
  it("averages readings per UK hour of the week, with an overall fallback", () => {
    expect(weekHour(MON_2PM)).toBe("Mon-14");
    const model = parseSpreads(null);
    for (let i = 0; i < 6; i++) addReading(model, "XAUUSD", 0.2 + i * 0.02, MON_2PM + i * 60_000);
    expect(typicalSpread(model, "XAUUSD", MON_2PM)).toBeCloseTo(0.25, 6);
    // A quiet hour with no readings of its own uses the overall average.
    expect(typicalSpread(model, "XAUUSD", Date.parse("2026-11-04T03:00:00Z"))).toBeCloseTo(0.25, 6);
    expect(typicalSpread(model, "BTCUSD", MON_2PM)).toBeNull();
    expect(latestSpread(model, "XAUUSD", MON_2PM + 6 * 60_000)).toBeCloseTo(0.3, 6);
    // Stale after a few minutes.
    expect(latestSpread(model, "XAUUSD", MON_2PM + 60 * 60_000)).toBeNull();
  });

  it("too few readings say nothing yet", () => {
    const model = addReading(parseSpreads(null), "BTCUSD", 12, MON_2PM);
    expect(typicalSpread(model, "BTCUSD", MON_2PM)).toBeNull();
  });
});

describe("brokerLevels", () => {
  const buy = {
    direction: "BUY" as const,
    entry: 100,
    stop: 95,
    targets: [104, 104, 104] as [number, number, number],
  };
  it("a buy's take profit and stop are hit on the bid, half a spread under the mid", () => {
    expect(brokerLevels(buy, 0.5)).toEqual({
      ...buy,
      entry: 99.5,
      stop: 95.5,
      targets: [104.5, 104.5, 104.5],
    });
    expect(brokerLevels({ ...buy, direction: "SELL" as const }, 0.5)).toMatchObject({
      entry: 100.5,
      stop: 94.5,
      targets: [103.5, 103.5, 103.5],
    });
    expect(brokerLevels(buy, 0)).toBe(buy);
  });
  it("a mid-price high exactly on the take profit isn't a hit at the broker", () => {
    const open = { ...buy, status: "open" as const, expiresAt: 10 * 60_000 };
    const touch = [{ t: 0, o: 100, h: 104, l: 99, c: 103 }];
    expect(advanceSignal(open, touch, 60_000).status).toBe("tp3");
    expect(advanceSignal(brokerLevels(open, 0.25), touch, 60_000).status).toBe("open");
  });
});
