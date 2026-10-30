import { describe, expect, it } from "vitest";
import { BAR_MIN_DECIDED, learnedBar, type BandTrade } from "./signal-alert-bar.server";
import { DESK_RUNS_PER_DAY, runsToday, takeDeskRun } from "./signal-ai-budget.server";
import { BROADCAST_MIN_CONFIDENCE, scanAndBroadcast } from "./signal-broadcast.server";

// More trades without running the free AI keys dry: 15-minute scalps too, an
// alert bar that only comes down where trades under it have been winning, and
// a daily cap on the AI desk's automatic runs.

const trades = (
  confidence: number,
  wins: number,
  losses: number,
  win = 30,
  loss = -40,
): BandTrade[] => [
  ...Array.from({ length: wins }, () => ({ confidence, outcome: "win" as const, pips: win })),
  ...Array.from({ length: losses }, () => ({ confidence, outcome: "loss" as const, pips: loss })),
];

describe("learnedBar", () => {
  it("stays at 70 until the trades under it win after the spread", () => {
    expect(BROADCAST_MIN_CONFIDENCE).toBe(70);
    expect(learnedBar([], 3.5)).toBe(70);
    // 65–69 winning 12 of 18 and making money: the bar comes down to 65.
    expect(learnedBar(trades(67, 12, 6), 3.5)).toBe(65);
    // 60–64 doing well too: 60, never lower.
    expect(learnedBar([...trades(67, 12, 6), ...trades(62, 12, 5)], 3.5)).toBe(60);
  });
  it("too few trades, too many losses, or no money after the spread keeps it up", () => {
    expect(learnedBar(trades(67, BAR_MIN_DECIDED - 6, 5), 3.5)).toBe(70);
    expect(learnedBar(trades(67, 9, 9), 3.5)).toBe(70);
    // Wins a lot, but each win is smaller than the spread eats.
    expect(learnedBar(trades(67, 12, 6, 6, -6), 3.5)).toBe(70);
    // 65–69 losing: 60–64 isn't even looked at.
    expect(learnedBar([...trades(67, 5, 12), ...trades(62, 15, 2)], 3.5)).toBe(70);
  });
});

/** A small in-memory site_content. */
function fakeSettings() {
  const rows: Record<string, string> = {};
  return {
    rows,
    from: () => {
      let key = "";
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => ((key = v), q),
        maybeSingle: async () => ({ data: key in rows ? { value: rows[key] } : null, error: null }),
        upsert: async (row: { key: string; value: string }) => (
          (rows[row.key] = row.value),
          { error: null }
        ),
      };
      return q;
    },
  };
}

describe("AI desk budget", () => {
  it("counts the automatic desk runs per UK day and stops at the cap", async () => {
    const admin = fakeSettings();
    const day = Date.parse("2026-11-04T10:00:00Z");
    for (let i = 0; i < DESK_RUNS_PER_DAY; i++) expect(await takeDeskRun(admin, day)).toBe(true);
    expect(await takeDeskRun(admin, day)).toBe(false);
    expect(runsToday(admin.rows["signals.deskRuns"], day)).toBe(DESK_RUNS_PER_DAY);
    // A new UK day, a fresh budget.
    expect(await takeDeskRun(admin, Date.parse("2026-11-05T00:30:00Z"))).toBe(true);
  });
  it("can't read the budget: the AI is spared", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }),
        }),
      }),
    };
    expect(await takeDeskRun(broken)).toBe(false);
  });
});

describe("scanner: 15-minute scalps and the learned bar", () => {
  type Row = Record<string, unknown>;
  const db = () => {
    const rows: Row[] = [];
    const from = () => {
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: () => q,
        gt: () => q,
        gte: () => q,
        insert: (row: Row) => (rows.push(row), Promise.resolve({ error: null })),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return q;
    };
    return { from, rows };
  };
  const card = (market: string, timeframe: string, confidencePct: number) => ({
    reply: `${market} ${timeframe} card`,
    plan: {
      market,
      label: market,
      direction: "BUY" as const,
      confidencePct,
      entry: 100,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
    summary: { timeframe, stop: 95 } as never,
  });

  it("scans both charts and posts what clears each market's bar", async () => {
    const d = db();
    const asked: string[] = [];
    const out = await scanAndBroadcast(d, {
      frames: ["5m", "15m"],
      build: async (ask) => {
        asked.push(ask);
        const tf = ask.endsWith("15m") ? "15M" : "5M";
        return ask.startsWith("XAU") ? card("XAUUSD", tf, tf === "15M" ? 66 : 50) : { reply: "" };
      },
      // Gold's bar has come down to 65; bitcoin's is still 70.
      alertBar: async (m) => (m === "XAUUSD" ? 65 : 70),
      post: async () => 1,
      now: Date.now,
    });
    expect(asked).toEqual([
      "XAUUSD signal 5m",
      "BTCUSD signal 5m",
      "XAUUSD signal 15m",
      "BTCUSD signal 15m",
    ]);
    expect(out.posted).toEqual(["XAUUSD BUY 15M"]);
    expect(d.rows[0]).toMatchObject({ timeframe: "15M" });
  });
});
