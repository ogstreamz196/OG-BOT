// The test account: a pretend Vantage Standard STP account that takes every
// alert the trade bot posts in the signals chat, so the chat can see how the
// signals would really have done with money on them.
//
// - It starts at the Boss's chosen balance (site_content "signals.paper").
// - Each alert's lot is chosen in 0.05 steps from LOT_STEP (0.05) to
//   PAPER_MAX_LOT (0.3), learned from wins and losses (chooseLot): how sure
//   the alert is, how the bot's recent calls at that confidence on that
//   market actually did (average result in risks), and the demo's own form
//   (losses in a row, drop from its best balance) to trade smaller after
//   mistakes. Never more than MAX_RISK_PCT of the balance lost at the stop.
// - The lot is chosen per alert (the signals chat's compact card leaves the
//   balance, lot and why lines off; paperLines still builds them); the lot is
//   kept with the trade (feeds.paper) and the card's dollar figures are for it.
// - When a trade ends, its profit or loss (paperPnl) is worked out like
//   Vantage would: Standard STP has no commission, the cost is the spread,
//   so a buy fills on the ask and closes on the bid. That's stored with the
//   trade (feeds.paper.pnl) and the balance is the start plus every closed
//   trade's result since the start (paperBalance), so it's never out of step.
import { usdPerLotMove } from "./trade-bias";
import { PROFIT_LOCK } from "./trade-signal-outcome";

type Admin = any;

export const PAPER_KEY = "signals.paper";
/** The smallest lot, and the step lots go up in. */
export const LOT_STEP = 0.05;
/** The Boss's limit: never more than this on one trade. */
export const PAPER_MAX_LOT = 0.3;
export const BIG_CONFIDENCE = 85;
/** Never risk more than this share of the balance at the stop (the smallest lot aside). */
export const MAX_RISK_PCT = 5;
/** Settled calls needed before their results move the lot. */
export const MIN_EDGE_TRADES = 8;

export type PaperState = { start: number; startedAt: string };
export type PaperFeeds = { lots: number; pnl?: number; balance?: number; why?: string };

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

/** The demo's profit or loss per market since it started, in dollars (read only). */
export async function paperByMarket(
  admin: Admin,
  state: PaperState,
): Promise<Record<string, number>> {
  const { data, error } = await admin
    .from("trade_signals")
    .select("market, feeds")
    .eq("sender_worker", "trade")
    .gte("created_at", state.startedAt)
    .limit(5000);
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { market: string; feeds: { paper?: PaperFeeds } | null }[]) {
    const pnl = Number(r.feeds?.paper?.pnl);
    if (Number.isFinite(pnl) && r.feeds?.paper?.lots) out[r.market] = (out[r.market] ?? 0) + pnl;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
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

/** What the lot is learned from (all optional: missing means neutral). */
export type LotInputs = {
  market: string;
  entry: number;
  stop: number;
  balance: number;
  confidencePct: number;
  /** An extremely confident quick scalp (bigOne). */
  big: boolean;
  /** The average result, in risks, of recent settled calls like this one. */
  edge?: number | null;
  /** How many settled calls that average is over. */
  edgeTrades?: number;
  /** The demo's losses in a row, newest first. */
  lossStreak?: number;
  /** How far the balance is below the demo's best, in percent. */
  drawdownPct?: number;
};

const steps = (lots: number) => Math.round(lots / LOT_STEP);
const lotOf = (n: number) => Math.round(n * LOT_STEP * 100) / 100;

/**
 * The lot for an alert, in 0.05 steps from 0.05 to 0.3, and why. Pure.
 * - Start from how sure it is: under 75% 0.1, 75–84% 0.15, 85%+ 0.2, an
 *   extremely confident quick scalp 0.25.
 * - What's been working: with MIN_EDGE_TRADES or more settled calls like it,
 *   +0.05 when they've averaged half a risk or more, +0.1 at a full risk;
 *   −0.05 when they've lost on average, −0.1 when badly (−0.3 risks).
 * - Learning from mistakes: two losses in a row −0.05, three or more −0.1;
 *   the balance 10% below its best −0.05, 20% −0.1 (the bigger of the two).
 * - Allowance: cut down so the stop can't lose more than MAX_RISK_PCT of the
 *   balance, but never below 0.05 while that still fits the balance; 0 when
 *   the account's blown.
 */
export function chooseLot(o: LotInputs): { lots: number; why: string } {
  if (!(o.balance > 0)) return { lots: 0, why: "the account's blown" };
  const max = steps(PAPER_MAX_LOT);
  let n = o.big ? 5 : o.confidencePct >= BIG_CONFIDENCE ? 4 : o.confidencePct >= 75 ? 3 : 2;
  const why: string[] = [`${o.confidencePct}% sure`];
  if (o.edge != null && Number.isFinite(o.edge) && (o.edgeTrades ?? 0) >= MIN_EDGE_TRADES) {
    const r = o.edge.toFixed(1);
    const over = `${o.edgeTrades} calls like it`;
    if (o.edge >= 1) ((n += 2), why.push(`${over} averaged +${r}R`));
    else if (o.edge >= 0.5) ((n += 1), why.push(`${over} averaged +${r}R`));
    else if (o.edge <= -0.3) ((n -= 2), why.push(`${over} lost ${r}R on average`));
    else if (o.edge < 0) ((n -= 1), why.push(`${over} lost ${r}R on average`));
  }
  const streak = o.lossStreak ?? 0;
  const dd = o.drawdownPct ?? 0;
  const formCut = Math.max(streak >= 3 ? 2 : streak >= 2 ? 1 : 0, dd >= 20 ? 2 : dd >= 10 ? 1 : 0);
  if (formCut) {
    n -= formCut;
    why.push(
      streak >= 2
        ? `${streak} losses in a row, so smaller`
        : `${Math.round(dd)}% off the best balance, so smaller`,
    );
  }
  n = Math.max(1, Math.min(max, n));
  // The allowance: what the stop would lose per lot.
  const per = usdPerLotMove(o.market, o.entry);
  const lossPerLot = per ? Math.abs(o.entry - o.stop) * per : 0;
  if (lossPerLot > 0) {
    const fit = Math.floor((o.balance * MAX_RISK_PCT) / 100 / lossPerLot / LOT_STEP + 1e-9);
    if (fit < n) {
      n = Math.max(1, fit);
      why.push(`capped so the stop risks ${MAX_RISK_PCT}% at most`);
    }
    if (lossPerLot * lotOf(n) > o.balance)
      return { lots: 0, why: "too little left to cover the stop" };
  }
  return { lots: lotOf(n), why: why.join(", ") };
}

/** A settled call's result in risks (null when it doesn't count: never filled, or still going). */
export function resultInRisks(row: {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  best_target: number;
  feeds?: { lock?: boolean } | null;
}): number | null {
  const side = row.direction === "BUY" ? 1 : -1;
  const risk = Math.abs(Number(row.entry) - Number(row.stop));
  if (!(risk > 0)) return null;
  const inR = (px: number) => ((px - Number(row.entry)) * side) / risk;
  if (Number(row.best_target) >= 1) return inR(Number(row.tp1));
  if (row.status === "stopped") return -1;
  if (row.status === "breakeven")
    return row.feeds?.lock
      ? inR(Number(row.entry) + (Number(row.tp1) - Number(row.entry)) * PROFIT_LOCK.keep)
      : 0;
  if (row.status === "expired") return 0;
  return null;
}

/** The demo's losses in a row (newest first) and drop from its best balance, from its closed trades oldest first. Pure. */
export function demoForm(
  start: number,
  pnls: number[],
): { lossStreak: number; drawdownPct: number } {
  let bal = start;
  let peak = start;
  for (const p of pnls) {
    bal += p;
    peak = Math.max(peak, bal);
  }
  let lossStreak = 0;
  for (let i = pnls.length - 1; i >= 0 && pnls[i] < 0; i--) lossStreak++;
  return { lossStreak, drawdownPct: peak > 0 ? Math.max(0, ((peak - bal) / peak) * 100) : 0 };
}

/** Confidence bands calls are compared in. */
export function confidenceBand(pct: number): [number, number] {
  if (pct >= 85) return [85, 101];
  if (pct >= 80) return [80, 85];
  if (pct >= 75) return [75, 80];
  if (pct >= 70) return [70, 75];
  return [0, 70];
}

/**
 * What the lot is learned from, read from stored trades (nothing deleted,
 * nothing changed): the last 40 settled signals-chat calls in the last 60
 * days on this market at this confidence band, and the demo's own closed
 * trades since it started. Never throws; anything missing is neutral.
 */
export async function lotInputs(
  admin: Admin,
  state: PaperState,
  market: string,
  confidencePct: number,
  now = Date.now(),
): Promise<Pick<LotInputs, "edge" | "edgeTrades" | "lossStreak" | "drawdownPct">> {
  const [lo, hi] = confidenceBand(confidencePct);
  const out: Pick<LotInputs, "edge" | "edgeTrades" | "lossStreak" | "drawdownPct"> = {};
  try {
    const { data } = await admin
      .from("trade_signals")
      .select("direction, entry, stop, tp1, status, best_target, feeds, confidence_pct")
      .eq("sender_worker", "trade")
      .eq("market", market)
      .gte("confidence_pct", lo)
      .lt("confidence_pct", hi)
      .gte("created_at", new Date(now - 60 * 86_400_000).toISOString())
      .not("status", "in", "(pending,open,tp1,tp2)")
      .order("created_at", { ascending: false })
      .limit(80);
    const rs = ((data ?? []) as Parameters<typeof resultInRisks>[0][])
      .filter((r) => !(r.feeds as { bias?: boolean } | null)?.bias)
      .map(resultInRisks)
      .filter((r): r is number => r != null)
      .slice(0, 40);
    if (rs.length) {
      out.edge = rs.reduce((a, b) => a + b, 0) / rs.length;
      out.edgeTrades = rs.length;
    }
  } catch {
    /* neutral */
  }
  try {
    const { data } = await admin
      .from("trade_signals")
      .select("feeds, closed_at")
      .eq("sender_worker", "trade")
      .gte("created_at", state.startedAt)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: true })
      .limit(5000);
    const pnls = ((data ?? []) as { feeds: { paper?: PaperFeeds } | null }[])
      .map((r) => Number(r.feeds?.paper?.pnl))
      .filter((n) => Number.isFinite(n) && n !== 0);
    Object.assign(out, demoForm(state.start, pnls));
  } catch {
    /* neutral */
  }
  return out;
}

/** Money with cents only when there are cents: $1,000, $1,042.30. */
const usd = (n: number) =>
  `$${n
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\.00$/, "")}`;

/** Card money figures always carry cents: −$50.00, +$30.00. */
const usd2 = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The demo's line in the results post at the bottom of the signals chat,
 * refreshed after every alert and update, so everyone sees the balance live.
 */
export function demoLine(_start: number, balance: number): string {
  // Just the balance now (the Boss's choice: no starting amount, no change).
  return `💰 Balance: ${usd(balance)}`;
}

/** OG B0T's one-off "money where my mouth is" post when the demo starts. */
export function demoAnnouncement(
  start: number,
  /** After a fresh start: the counter restarts too. */
  fresh = false,
): string {
  // Short (the Boss's choice: no life story).
  const amount = usd(start);
  return [
    "💸 PUTTING MY MONEY WHERE MY MOUTH IS",
    `Every alert in here now trades a ${amount} demo Vantage account. ${fresh ? "Counter from zero." : "Counter carries on."}`,
    "🧪 Demo money, real prices. Not financial advice.",
  ].join("\n");
}

/** The test account's lines on an alert card. */
export function paperLines(balance: number, lots: number, why?: string): string[] {
  return [
    ...(lots >= PAPER_MAX_LOT
      ? [`🔥 I'm going hard on this one: ${PAPER_MAX_LOT} lot, my limit`]
      : []),
    `💰 Test account balance: ${usd(balance)} · this trade ${lots} lot`,
    ...(why ? [`📏 Why ${lots}: ${why}`] : []),
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
    return `${sign}${usd2(n)}`;
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
  /** Where the profit lock put the stop, when the trade had one. */
  lockStop?: number | null;
};

/**
 * What a closed test trade made or lost at Vantage (Standard STP: no
 * commission, the spread is the cost). The bot's levels are hit on the bid
 * (a buy) or the ask (a sell), so a take profit or stop pays exactly its
 * level (so does the profit lock's stop); a market entry also pays half the
 * spread; a trade closed on time
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
      // A third at TP1; the rest at the runner, or back at the moved stop
      // (the profit lock, else the entry).
      const rest = t.bestTarget >= 2 ? move(t.tp3) : t.lockStop != null ? move(t.lockStop) : 0;
      points = move(t.tp1) / 3 + (rest * 2) / 3;
    }
  } else if (t.status === "breakeven") points = t.lockStop != null ? move(t.lockStop) : 0;
  else if (t.entered && (t.status === "expired" || t.status === "cancelled") && t.lastPrice != null)
    // Closed on time, or called off once in: out at the bid/ask.
    points = move(t.lastPrice) - half;
  else return 0; // never filled
  if (t.marketEntry) points -= half;
  return Math.round(points * per * lots * 100) / 100;
}
