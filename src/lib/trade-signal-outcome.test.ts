import { describe, expect, it } from "vitest";
import { advanceSignal, trackRecordText, type TrackedSignal } from "./trade-signal-outcome";

const bar = (t: number, l: number, h: number) => ({ t, o: l, h, l, c: h });
const buy: TrackedSignal = {
  direction: "BUY",
  entry: 100,
  stop: 95,
  targets: [105, 110, 115],
  status: "open",
  expiresAt: 10_000,
};

describe("signal outcomes", () => {
  it("walks a buy through TP1 and TP2, then back to breakeven", () => {
    const r = advanceSignal(
      buy,
      [bar(1, 99, 104), bar(2, 101, 106), bar(3, 104, 111), bar(4, 99.5, 108)],
      5,
    );
    expect(r.events.map((e) => e.kind)).toEqual(["tp1", "tp2", "breakeven"]);
    expect(r.status).toBe("breakeven");
  });

  it("counts the stop when one candle touches both stop and target", () => {
    const r = advanceSignal(buy, [bar(1, 94, 106)], 2);
    expect(r.status).toBe("stopped");
    expect(r.events).toEqual([{ kind: "stopped", at: 1, price: 95 }]);
  });

  it("reaches several targets in one big candle", () => {
    const r = advanceSignal(buy, [bar(1, 99, 116)], 2);
    expect(r.events.map((e) => e.kind)).toEqual(["tp1", "tp2", "tp3"]);
    expect(r.status).toBe("tp3");
  });

  it("fills a sell stop only when price breaks down through it", () => {
    const sellStop: TrackedSignal = {
      direction: "SELL",
      entryType: "stop",
      entry: 100,
      stop: 105,
      targets: [95, 90, 85],
      status: "pending",
      expiresAt: 10_000,
    };
    // Bouncing above the trigger doesn't fill; breaking below it does.
    expect(advanceSignal(sellStop, [bar(1, 101, 104)], 2).status).toBe("pending");
    const r = advanceSignal(sellStop, [bar(1, 101, 104), bar(2, 99, 101.5)], 3);
    expect(r.events[0]).toEqual({ kind: "filled", at: 2, price: 100 });
    expect(r.status).toBe("open");
    // A buy stop fills on the way up.
    const buyStop: TrackedSignal = { ...buy, entryType: "stop", status: "pending" };
    expect(advanceSignal(buyStop, [bar(1, 97, 99)], 2).status).toBe("pending");
    expect(advanceSignal(buyStop, [bar(1, 98, 100.5)], 2).status).toBe("open");
  });

  it("fills a sell limit only when price trades up to it", () => {
    const sell: TrackedSignal = {
      ...buy,
      direction: "SELL",
      stop: 105,
      targets: [95, 90, 85],
      status: "pending",
    };
    const r = advanceSignal(sell, [bar(1, 97, 99), bar(2, 98, 100.5), bar(3, 94, 99)], 4);
    expect(r.events.map((e) => e.kind)).toEqual(["filled", "tp1"]);
    expect(r.status).toBe("tp1");
  });

  it("a fill and stop in the same candle is a loss", () => {
    const r = advanceSignal({ ...buy, status: "pending" }, [bar(1, 94, 101)], 2);
    expect(r.events.map((e) => e.kind)).toEqual(["filled", "stopped"]);
  });

  it("times out: unfilled limits and open trades", () => {
    expect(advanceSignal({ ...buy, status: "pending" }, [bar(1, 101, 103)], 20_000).status).toBe(
      "unfilled",
    );
    expect(advanceSignal(buy, [bar(1, 99, 103)], 20_000).status).toBe("expired");
  });

  it("ignores candles after the expiry", () => {
    const r = advanceSignal(buy, [bar(10_000, 90, 120)], 20_000);
    expect(r.events.map((e) => e.kind)).toEqual(["expired"]);
  });

  it("leaves a quiet signal alone", () => {
    expect(advanceSignal(buy, [bar(1, 98, 103)], 2)).toEqual({ status: "open", events: [] });
  });
});

describe("track record", () => {
  const row = (status: string, best: number, entered = true) =>
    ({ status, best_target: best, entered }) as never;
  it("needs enough filled signals", () => {
    expect(
      trackRecordText([row("tp3", 3), row("stopped", 0), row("unfilled", 0, false)], 30),
    ).toBeNull();
  });
  it("reports TP1 hits, stops and the rest, ignoring unfilled and active", () => {
    const text = trackRecordText(
      [
        row("tp3", 3),
        row("breakeven", 1),
        row("stopped", 0),
        row("stopped", 0),
        row("expired", 0),
        row("unfilled", 0, false),
        row("open", 0),
      ],
      30,
    );
    expect(text).toBe(
      "last 30 days, 5 signals filled: TP1 hit on 2 (40%), stopped out before TP1 on 2, 1 ended early or ran out of time. Past results don't promise future ones.",
    );
  });
});
