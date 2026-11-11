import { describe, expect, test } from "vitest";
import {
  asksAboutResults,
  resultFor,
  resultPeriods,
  setupKey,
  summarise,
  type ResultRow,
} from "./signal-results.server";

// The bot's results book: what counts as a win or a loss, the pips, and the
// UK-time periods it answers "how much did we make" from.

const gold = {
  id: "g1",
  market: "XAUUSD",
  label: "XAU/USD",
  direction: "SELL" as const,
  entry: 2650,
  stop: 2655,
  tp1: 2647,
  tp2: 2644,
  tp3: 2640,
  pip: 0.1,
  decimals: 2,
};

describe("resultFor", () => {
  test("a win counts the pips to the furthest target reached", () => {
    expect(resultFor(gold, 1, false)).toEqual({
      outcome: "win",
      best_target: 1,
      pips: 30,
      unit: "pips",
    });
    expect(resultFor(gold, 3, false)?.pips).toBe(100);
  });
  test("a target banked before a stop out is still a win", () => {
    expect(resultFor(gold, 1, true)?.outcome).toBe("win");
  });
  test("a stop loss first is a loss of the full stop distance", () => {
    expect(resultFor(gold, 0, true)).toEqual({
      outcome: "loss",
      best_target: 0,
      pips: -50,
      unit: "pips",
    });
  });
  test("neither yet: nothing to book", () => {
    expect(resultFor(gold, 0, false)).toBeNull();
  });
  test("markets without a pip size count in points", () => {
    const btc = {
      ...gold,
      market: "BTCUSD",
      pip: null,
      direction: "BUY" as const,
      entry: 100,
      stop: 95,
      tp1: 104,
    };
    expect(resultFor(btc, 1, false)).toMatchObject({ pips: 4, unit: "points" });
  });
  test("the same setup in several chats shares one key", () => {
    expect(setupKey(gold)).toBe(setupKey({ ...gold, id: "g2" }));
  });
});

describe("resultPeriods (UK time)", () => {
  test("on a Tuesday afternoon in winter", () => {
    const now = Date.parse("2026-10-27T15:00:00Z"); // Tue, GMT
    const p = Object.fromEntries(resultPeriods(now).map(([l, a, b]) => [l.split(" (")[0], [a, b]]));
    expect(p.Today[0]).toBe(Date.parse("2026-10-27T00:00:00Z"));
    expect(p.Yesterday).toEqual([
      Date.parse("2026-10-26T00:00:00Z"),
      Date.parse("2026-10-27T00:00:00Z"),
    ]);
    // Saturday was still summer time (the clocks went back on Sunday 25th).
    expect(p["Since the weekend"][0]).toBe(Date.parse("2026-10-23T23:00:00Z"));
    expect(p["This week"][0]).toBe(Date.parse("2026-10-26T00:00:00Z"));
    expect(p["This month"][0]).toBe(Date.parse("2026-09-30T23:00:00Z")); // 1 Oct, BST
  });
  test("UK midnight in summer time", () => {
    const now = Date.parse("2026-07-15T10:00:00Z"); // Wed, BST
    expect(resultPeriods(now)[0][1]).toBe(Date.parse("2026-07-14T23:00:00Z"));
  });
  test("on a Sunday the weekend started yesterday", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const weekend = resultPeriods(now).find(([l]) => l.startsWith("Since the weekend"))!;
    expect(weekend[1]).toBe(Date.parse("2026-10-31T00:00:00Z"));
  });
});

describe("summarise", () => {
  const row = (o: Partial<ResultRow>): ResultRow => ({
    setup_key: "k",
    market: "XAUUSD",
    label: "XAU/USD",
    direction: "BUY",
    outcome: "win",
    best_target: 1,
    pips: 30,
    unit: "pips",
    decided_at: "2026-10-27T10:00:00Z",
    ...o,
  });
  test("wins, losses and pips per market, never mixed", () => {
    const line = summarise(
      [
        row({}),
        row({ outcome: "loss", pips: -50 }),
        row({ market: "BTCUSD", label: "BTC/USD", pips: 120, unit: "points" }),
      ],
      "Today",
    );
    expect(line).toBe(
      "- Today: 2 won (hit a target), 1 lost (stop loss hit) · XAU/USD -20.0 pips · BTC/USD +120.0 points",
    );
  });
  test("an empty period says so", () => {
    expect(summarise([], "Yesterday")).toContain("no trades");
  });
});

describe("asksAboutResults", () => {
  test.each([
    "how much did we make yesterday",
    "How much did we make today?",
    "how many pips since the weekend",
    "what's the results this week",
    "today's profit?",
  ])("%s", (t) => expect(asksAboutResults(t)).toBe(true));
  test.each(["give me a gold signal", "how are you", "roast my mate"])("not: %s", (t) =>
    expect(asksAboutResults(t)).toBe(false),
  );
});
