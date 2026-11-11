import { describe, expect, it } from "vitest";
import { buildReport, timingStats, type LiveRow, type ShadowDone } from "./signal-report.server";

// The Boss's signal report: where the wins and losses come from.

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  market: "XAUUSD",
  label: "XAU/USD (Gold)",
  direction: "BUY",
  entry: 2650,
  stop: 2645,
  tp1: 2653,
  tp2: 2653,
  tp3: 2653,
  pip: 0.1,
  decimals: 2,
  status: "tp3",
  best_target: 3,
  confidence_pct: 72,
  // 09:00 UK in winter: the London session.
  created_at: "2026-11-02T09:00:00Z",
  feeds: { desk: "backed" },
  ...over,
});

describe("buildReport", () => {
  it("splits live results by confidence, session, the desk's say and setup, before and after spread", () => {
    const live = [
      row(),
      row({ entry: 2660, stop: 2655, tp1: 2663, tp2: 2663, tp3: 2663 }),
      row({
        entry: 2670,
        stop: 2665,
        status: "stopped",
        best_target: 0,
        confidence_pct: 64,
        created_at: "2026-11-02T14:00:00Z",
        feeds: { setup: "Breakout & retest" },
      }),
      // Still running, a cancelled order and a bias call never count.
      row({ entry: 2680, stop: 2675, status: "open", best_target: 0 }),
      row({ entry: 2690, stop: 2685, status: "unfilled", best_target: 0 }),
      row({ entry: 2700, stop: 2695, feeds: { bias: true } }),
    ];
    const r = buildReport(live, null, 30);
    const gold = r.markets[0];
    expect(gold.spread).toBe(3.5);
    // Two wins of 30 pips, one loss of 50: +10 gross, minus 3 × 3.5 spread.
    expect(gold.overall).toMatchObject({ wins: 2, losses: 1, pips: 10, netPips: -0.5 });
    expect(gold.byBand.map((b) => [b.label, b.wins, b.losses])).toEqual([
      ["60–69%", 0, 1],
      ["70–79%", 2, 0],
    ]);
    expect(gold.bySession.map((s) => s.label)).toEqual(["London session", "New York session"]);
    expect(gold.byDesk.map((d) => [d.label, d.wins, d.losses])).toEqual([
      ["AI desk backed it", 2, 0],
      ["Not checked (member asks)", 0, 1],
    ]);
    expect(gold.bySetup.map((s) => s.label)).toEqual(["Main chart engine", "Breakout & retest"]);
    expect(gold.shadows).toBeNull();
  });

  it("the same setup sent to several chats counts once", () => {
    const r = buildReport([row(), row({ feeds: null })], [], 7);
    expect(r.markets[0].overall.wins).toBe(1);
    // The auto-post's desk verdict is the one kept.
    expect(r.markets[0].byDesk[0].label).toBe("AI desk backed it");
  });

  it("shows how the setups that weren't sent would have done, by why", () => {
    const shadow = (reason: string, outcome: ShadowDone["outcome"], pips: number): ShadowDone => ({
      market: "BTCUSD",
      label: "BTC/USD",
      reason,
      outcome,
      pips,
      pip: null,
    });
    const r = buildReport(
      [],
      [
        shadow("desk_no", "win", 40),
        shadow("desk_no", "loss", -60),
        shadow("desk_no", "unfilled", 0),
        shadow("quiet", "flat", 5),
      ],
      30,
    );
    const btc = r.markets[0];
    expect(btc.unit).toBe("points");
    expect(btc.shadows).toEqual([
      {
        label: "AI desk said no",
        wins: 1,
        losses: 1,
        winRate: 0.5,
        pips: -20,
        netPips: -50,
        unfilled: 1,
        flat: 0,
      },
      {
        label: "Too quiet",
        wins: 0,
        losses: 0,
        winRate: null,
        pips: 5,
        netPips: -10,
        unfilled: 0,
        flat: 1,
      },
    ]);
  });
});

describe("timingStats", () => {
  it("how late alerts went out, how far price had moved, and how long trades took", () => {
    const at = (iso: string) => Date.parse(iso);
    const rows = [
      // Posted 25s after the 09:00 close, built 18s before; price already 1.5 up on a buy.
      row({
        created_at: "2026-11-02T09:00:25Z",
        entered_at: "2026-11-02T09:00:25Z",
        closed_at: "2026-11-02T09:12:25Z",
        feeds: {
          timing: {
            candleAt: at("2026-11-02T09:00:00Z"),
            builtAt: at("2026-11-02T09:00:07Z"),
            postedAt: at("2026-11-02T09:00:25Z"),
            pricePosted: 2650.15,
          },
        },
      }),
      // A pullback entry that filled 6 minutes later, then stopped 20 minutes after.
      row({
        entry: 2660,
        stop: 2655,
        status: "stopped",
        best_target: 0,
        created_at: "2026-11-02T10:00:00Z",
        entered_at: "2026-11-02T10:06:00Z",
        closed_at: "2026-11-02T10:26:00Z",
      }),
      // One never filled; one closed on a time stop.
      row({ entry: 2670, status: "unfilled", best_target: 0, created_at: "2026-11-02T11:00:00Z" }),
      row({
        entry: 2680,
        status: "expired",
        best_target: 0,
        created_at: "2026-11-02T12:00:00Z",
        entered_at: "2026-11-02T12:00:00Z",
        feeds: { holdFor: 30 },
      }),
    ];
    expect(timingStats(rows, 0.1)).toEqual({
      alerts: 1,
      delaySec: 25,
      checkSec: 18,
      driftPips: 1.5,
      fillRate: 0.5,
      fillMin: 6,
      winMin: 12,
      lossMin: 20,
      timeStops: 1,
    });
  });
});
