import { vi, describe, expect, it } from "vitest";
import {
  RELAX_MIN_DECIDED,
  TIGHTEN_MIN_DECIDED,
  nextFilterState,
  parseFilters,
  type FilterTrade,
} from "./signal-filter-learning.server";
import { deskConfirmer } from "./signal-broadcast.server";

// The signals chat's purge time comes from the live database; tests must
// never read it (with real credentials, a recent purge hid every test post).
vi.mock("./signal-chat.server", async (real) => ({
  ...(await real<object>()),
  chatPurgedAt: async () => null,
}));

// The filters learn: one whose blocked setups keep winning switches itself
// off for that market, and back on if what it then lets through loses.

const NOW = Date.parse("2026-11-04T12:00:00Z");
const trades = (wins: number, losses: number, win = 30, loss = -40): FilterTrade[] => [
  ...Array.from({ length: wins }, () => ({ outcome: "win" as const, pips: win })),
  ...Array.from({ length: losses }, () => ({ outcome: "loss" as const, pips: loss })),
];

describe("nextFilterState", () => {
  it("a filter blocking winners is switched off", () => {
    const s = nextFilterState(undefined, trades(12, 6), [], 3.5, NOW);
    expect(s).toMatchObject({ relaxed: true, shadow: { wins: 12, losses: 6 } });
    expect(s.since).toBe(new Date(NOW).toISOString());
  });

  it("stays on with too few trades, too many losses, or no money after the spread", () => {
    expect(nextFilterState(undefined, trades(RELAX_MIN_DECIDED - 5, 4), [], 3.5, NOW).relaxed).toBe(
      false,
    );
    expect(nextFilterState(undefined, trades(8, 10), [], 3.5, NOW).relaxed).toBe(false);
    expect(nextFilterState(undefined, trades(12, 6, 5, -5), [], 3.5, NOW).relaxed).toBe(false);
  });

  it("switched off, it's judged on what it lets through, and back on if that loses", () => {
    const off = nextFilterState(undefined, trades(12, 6), [], 3.5, NOW);
    // Too few live trades yet: stays off.
    expect(nextFilterState(off, [], trades(2, 5), 3.5, NOW).relaxed).toBe(true);
    // Still winning: stays off.
    expect(nextFilterState(off, [], trades(7, 4), 3.5, NOW).relaxed).toBe(true);
    // Losing: back on.
    const on = nextFilterState(off, [], trades(3, TIGHTEN_MIN_DECIDED), 3.5, NOW + 1000);
    expect(on).toMatchObject({ relaxed: false, live: { wins: 3, losses: TIGHTEN_MIN_DECIDED } });
  });

  it("reads saved state, and starts empty", () => {
    expect(parseFilters(null)).toEqual({ v: 1, markets: {} });
    expect(
      parseFilters('{"v":1,"markets":{"XAUUSD":{"choppy":{"relaxed":true}}}}').markets.XAUUSD,
    ).toEqual({ choppy: { relaxed: true } });
  });
});

describe("the desk's no, learned off", () => {
  it("the alert goes out without asking the AI", async () => {
    let asked = 0;
    const confirm = deskConfirmer(
      { from: () => ({}) },
      async () => {
        asked++;
        return { signal: { reply: "" }, desk: null };
      },
      { now: () => NOW, askUntil: NOW + 20_000, skipDesk: async () => true },
    );
    const signal = {
      reply: "card",
      plan: {
        market: "XAUUSD",
        label: "Gold",
        direction: "BUY" as const,
        confidencePct: 72,
        entry: 100,
        expiresAt: new Date(NOW + 3600_000).toISOString(),
      },
    };
    const out = await confirm(signal);
    expect(asked).toBe(0);
    expect(out?.plan?.feeds).toEqual({ desk: "relaxed", relaxed: "desk_no" });
  });
});
