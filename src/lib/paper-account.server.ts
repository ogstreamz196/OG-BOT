// The test account: a pretend Vantage Standard STP account that takes every
// alert the trade bot posts in the signals chat, so the chat can see how the
// signals would really have done with money on them.
//
// - It starts at the Boss's chosen balance (site_content "signals.paper").
// - Each alert trades PAPER_LOT (0.1 lot), or PAPER_BIG_LOT (0.3) on an
//   extremely confident quick scalp (bigOne): a 5-minute alert at
//   BIG_CONFIDENCE or more that every AI agreed with or the desk backed. A lot
//   that could lose more than the balance at its stop is cut down.
// - Every card shows the balance and the lot (paperLines); the lot is kept
//   with the trade (feeds.paper) and the card's dollar figures are for it.
// - When a trade ends, its profit or loss (paperPnl) is worked out like
//   Vantage would: Standard STP has no commission, the cost is the spread,
//   so a buy fills on the ask and closes on the bid. That's stored with the
//   trade (feeds.paper.pnl) and the balance is the start plus every closed
//   trade's result since the start (paperBalance), so it's never out of step.
import { usdPerLotMove } from "./trade-bias";

type Admin = any;

export const PAPER_KEY = "signals.paper";
export const PAPER_LOT = 0.1;
export const PAPER_BIG_LOT = 0.3;
export const BIG_CONFIDENCE = 85;

export type PaperState = { start: number; startedAt: string };
export type PaperFeeds = { lots: number; pnl?: number; balance?: number };

export function parsePaper(value: string | null | undefined): PaperState | null {
  try {
    const v = JSON.parse(value ?? "") as PaperState;
    return v && v.start > 0 && Number.isFinite(Date.parse(v.startedAt)) ? v : null;
  } catch {
    return null;
  }
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** The test account, or null when it isn't running. */
export async function paperState(admin: Admin): Promise<PaperState | null> {
  try {
    return parsePaper(await setting(admin, PAPER_KEY));
  } catch {
    return null;
  }
}

/** Starts (or restarts) the test account at `start` dollars, from now. */
export async function startPaper(admin: Admin, start: number, now = Date.now()) {
  const state: PaperState = { start, startedAt: new Date(now).toISOString() };
  await admin
    .from("site_content")
    .upsert(
      { key: PAPER_KEY, value: JSON.stringify(state), updated_at: state.startedAt },
      { onConflict: "key" },
    );
  return state;
}

/** The balance: the start plus every closed test trade's result since then. */
export async function paperBalance(admin: Admin, state: PaperState): Promise<number> {
  const { data, error } = await admin
    .from("trade_signals")
    .select("feeds")
    .eq("sender_worker", "trade")
    .gte("created_at", state.startedAt)
    .limit(5000);
  if (error) return state.start;
  let total = state.start;
  for (const r of (data ?? []) as { feeds: { paper?: PaperFeeds } | null }[]) {
    const pnl = Number(r.feeds?.paper?.pnl);
    if (Number.isFinite(pnl)) total += pnl;
  }
  return Math.round(total * 100) / 100;
}

/** Whether an alert is an extremely confident quick scalp (the 0.3-lot ones). */
export function bigOne(signal: {
  confidencePct: number;
  timeframe?: string;
  desk?: string;
}): boolean {
  return (
    signal.confidencePct >= BIG_CONFIDENCE &&
    (signal.timeframe ?? "5M") === "5M" &&
    (signal.desk === "backed" || signal.desk === "unanimous")
  );
}

/**
 * The lot for an alert: 0.1, or 0.3 on an extremely confident quick scalp,
 * cut down (to the nearest 0.01) so the stop can't lose more than the
 * balance. 0 when the account's blown.
 */
export function paperLots(
  market: string,
  entry: number,
  stop: number,
  balance: number,
  big: boolean,
): number {
  const want = big ? PAPER_BIG_LOT : PAPER_LOT;
  const per = usdPerLotMove(market, entry);
  if (!(balance > 0)) return 0;
  if (!per) return want;
  const lossPerLot = Math.abs(entry - stop) * per;
  if (!(lossPerLot > 0)) return want;
  const most = Math.floor((balance / lossPerLot) * 100) / 100;
  return Math.max(0, Math.min(want, most));
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The demo's line in the results post at the bottom of the signals chat,
 * refreshed after every alert and update, so everyone sees the balance live.
 */
export function demoLine(start: number, balance: number): string {
  const diff = Math.round((balance - start) * 100) / 100;
  const pct = start > 0 ? (diff / start) * 100 : 0;
  const sign = diff >= 0 ? "+" : "−";
  const mood = diff > 0 ? "📈" : diff < 0 ? "📉" : "💰";
  return (
    `${mood} ${usd(start)} DEMO: ${usd(balance)} ` +
    `(${sign}${usd(Math.abs(diff))} · ${sign}${Math.abs(pct).toFixed(1)}%)`
  );
}

/** OG B0T's one-off "money where my mouth is" post when the demo starts. */
export function demoAnnouncement(start: number): string {
  const amount = usd(start).replace(/\.00$/, "");
  return [
    "💸 PUTTING MY MONEY WHERE MY MOUTH IS",
    "",
    `Talk is cheap. So from right now, every alert my trade bot drops in here gets traded on a ${amount} demo Vantage Standard account. Same entries, same stops, same take profits you see on the cards.`,
    "",
    "0.1 lot a trade, 0.3 when I'm properly sure of a quick scalp. Spreads counted, no commission on Standard, no fiddling the numbers.",
    "",
    "The win/loss counter carries on as it is. The balance updates live on every card and in the results at the bottom of the chat.",
    "",
    `${amount} on the line. Let's see who's talking rubbish. 👀`,
    "",
    "🧪 Demo money, real prices. Educational, not financial advice.",
  ].join("\n");
}

/** The test account's lines on an alert card. */
export function paperLines(balance: number, lots: number, big: boolean): string[] {
  return [
    ...(big && lots >= PAPER_BIG_LOT
      ? [`🔥 I'm going harder on this one: ${PAPER_BIG_LOT} lot instead of ${PAPER_LOT}`]
      : []),
    `💰 Test account balance: ${usd(balance)} · this trade ${lots} lot`,
  ];
}

/**
 * The card's dollar figures (worked out for CARD_LOT, 0.5) rescaled to the
 * test account's lot, so what the card says is what the account makes or loses.
 */
export function rescaleCardMoney(card: string, fromLot: number, toLot: number): string {
  if (!(fromLot > 0) || fromLot === toLot) return card;
  return card.replace(/([−+])\$([\d,]+\.\d{2})/g, (_, sign: string, amount: string) => {
    const n = (Number(amount.replace(/,/g, "")) * toLot) / fromLot;
    return `${sign}${usd(n)}`;
  });
}

type ClosedTrade = {
  market: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  /** How it got in: market orders pay the ask (a buy) / bid (a sell) on top. */
  marketEntry: boolean;
  /** Whether the entry ever filled. */
  entered: boolean;
  status: string;
  bestTarget: number;
  /** Last price (mid) for a trade closed on time. */
  lastPrice: number | null;
};

/**
 * What a closed test trade made or lost at Vantage (Standard STP: no
 * commission, the spread is the cost). The bot's levels are hit on the bid
 * (a buy) or the ask (a sell), so a take profit or stop pays exactly its
 * level; a market entry also pays half the spread; a trade closed on time
 * goes out at the bid/ask, half a spread off the last mid. A runner banks a
 * third at the first take profit and the rest at the second, or at the
 * entry if it comes back. Pure, so it can be tested.
 */
export function paperPnl(t: ClosedTrade, lots: number, spread: number): number {
  const per = usdPerLotMove(t.market, t.entry) ?? 0;
  const side = t.direction === "BUY" ? 1 : -1;
  const half = Math.max(0, spread) / 2;
  const move = (exit: number) => (exit - t.entry) * side;
  let points = 0;
  const single = t.tp1 === t.tp3;
  if (t.status === "stopped") points = move(t.stop);
  else if (t.bestTarget >= 1) {
    if (single) points = move(t.tp1);
    else {
      // A third at TP1; the rest at the runner, or back at the entry.
      const rest = t.bestTarget >= 2 ? move(t.tp3) : 0;
      points = move(t.tp1) / 3 + (rest * 2) / 3;
    }
  } else if (t.status === "breakeven") points = 0;
  else if (t.entered && (t.status === "expired" || t.status === "cancelled") && t.lastPrice != null)
    // Closed on time, or called off once in: out at the bid/ask.
    points = move(t.lastPrice) - half;
  else return 0; // never filled
  if (t.marketEntry) points -= half;
  return Math.round(points * per * lots * 100) / 100;
}
