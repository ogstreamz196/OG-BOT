// More trades, earned: the confidence an auto-posted alert needs (70% by
// default) comes down for a market only when the setups just under it have
// been winning after the spread. Each band below the bar is judged on its
// shadow trades (setups the bot followed silently because they were under the
// bar) plus the auto-posted trades it already sent from that band, over the
// last 30 days. A band needs BAR_MIN_DECIDED won-or-lost trades, a win rate of
// at least BAR_MIN_WIN_RATE and money made after the spread; the bar steps
// down through the bands from the top and stops at the first one that hasn't
// earned it, never below BAR_FLOOR. A band that starts losing puts the bar
// straight back up. No AI is involved.
import { BROADCAST_MIN_CONFIDENCE } from "./signal-broadcast.server";
import { SPREAD_COST } from "./signal-learning.server";

type Admin = any;

/** The bands below the default bar, tried top first. */
export const BAR_BANDS: [number, number][] = [
  [65, 69],
  [60, 64],
];
export const BAR_FLOOR = 60;
export const BAR_MIN_DECIDED = 15;
export const BAR_MIN_WIN_RATE = 0.55;
const DAYS = 30;

/** One finished trade: its confidence, how it ended and the pips it made or lost. */
export type BandTrade = { confidence: number; outcome: "win" | "loss" | "flat"; pips: number };

/** The bar from finished trades (pure, so it can be tested). `spread` is in the trades' units. */
export function learnedBar(trades: BandTrade[], spread: number): number {
  let bar = BROADCAST_MIN_CONFIDENCE;
  for (const [lo, hi] of BAR_BANDS) {
    const band = trades.filter((t) => t.confidence >= lo && t.confidence <= hi);
    const wins = band.filter((t) => t.outcome === "win").length;
    const losses = band.filter((t) => t.outcome === "loss").length;
    const net = band.reduce((n, t) => n + t.pips - spread, 0);
    const decided = wins + losses;
    if (decided < BAR_MIN_DECIDED || wins / decided < BAR_MIN_WIN_RATE || net <= 0) break;
    bar = Math.max(BAR_FLOOR, lo);
  }
  return bar;
}

/** The alert bar for a market right now (cached 10 minutes). Never throws: the default on any trouble. */
export async function alertBar(admin: Admin, market: string, now = Date.now()): Promise<number> {
  try {
    const { cached } = await import("./server-cache");
    return await cached(`signal-alert-bar:${market}`, 10 * 60_000, async () => {
      const since = new Date(now - DAYS * 86_400_000).toISOString();
      const lowest = BAR_BANDS.at(-1)![0];
      const [shadows, live] = await Promise.all([
        admin
          .from("signal_shadows")
          .select("confidence_pct, outcome, pips, pip")
          .eq("market", market)
          .eq("reason", "below_alert")
          .gte("created_at", since)
          .gte("confidence_pct", lowest)
          .not("outcome", "is", null)
          .limit(5000),
        admin
          .from("trade_signals")
          .select(
            "confidence_pct, status, best_target, entry, stop, tp1, pip, direction, entered_at",
          )
          .eq("market", market)
          .eq("sender_worker", "trade")
          .gte("created_at", since)
          .gte("confidence_pct", lowest)
          .lt("confidence_pct", BROADCAST_MIN_CONFIDENCE)
          .limit(5000),
      ]);
      if (shadows.error) return BROADCAST_MIN_CONFIDENCE;
      const trades: BandTrade[] = [];
      let size = 1;
      for (const r of (shadows.data ?? []) as {
        confidence_pct: number;
        outcome: string;
        pips: number | null;
        pip: number | null;
      }[]) {
        if (Number(r.pip) > 0) size = Number(r.pip);
        if (r.outcome === "unfilled") continue;
        trades.push({
          confidence: Number(r.confidence_pct),
          outcome: r.outcome as BandTrade["outcome"],
          pips: Number(r.pips) || 0,
        });
      }
      // The alerts it's already sent from those bands count too.
      for (const r of (live.data ?? []) as {
        confidence_pct: number;
        status: string;
        best_target: number;
        entry: number;
        stop: number;
        tp1: number;
        pip: number | null;
        direction: "BUY" | "SELL";
        entered_at: string | null;
      }[]) {
        const unit = Number(r.pip) > 0 ? Number(r.pip) : 1;
        size = unit;
        const side = r.direction === "BUY" ? 1 : -1;
        const won = Number(r.best_target) >= 1;
        const lost = r.status === "stopped" && !won;
        if (!won && !lost) continue;
        trades.push({
          confidence: Number(r.confidence_pct),
          outcome: won ? "win" : "loss",
          pips: ((Number(won ? r.tp1 : r.stop) - Number(r.entry)) * side) / unit,
        });
      }
      return learnedBar(trades, (SPREAD_COST[market] ?? 0) / size);
    });
  } catch {
    return BROADCAST_MIN_CONFIDENCE;
  }
}
