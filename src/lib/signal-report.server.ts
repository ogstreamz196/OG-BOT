// The Boss's signal report: where the wins and losses really come from. Live
// signals (requests and auto-posts, never market-bias calls) are split by
// confidence band, trading session, what the AI desk said and which chart
// setup made them; the shadow trades (signal-shadows.server.ts) show how the
// setups each filter blocked would have done. Pips are shown before and after
// a typical spread (SPREAD_COST), since small take profits live or die on it.
import { resultFor, setupKey } from "./signal-results.server";
import { SPREAD_COST } from "./signal-learning.server";
import { SESSIONS, ukSession } from "./trade-signal";
import { SHADOW_REASONS, type ShadowReason } from "./signal-shadows.server";

type Admin = any;

export type Stat = {
  label: string;
  /** Won and lost (what the win rate is out of). */
  wins: number;
  losses: number;
  winRate: number | null;
  /** Before and after the spread, over won and lost trades. */
  pips: number;
  netPips: number;
  /** Shadows only: followed but never filled, or timed out flat. */
  unfilled?: number;
  flat?: number;
};

export type MarketReport = {
  market: string;
  label: string;
  unit: string;
  /** The spread taken off each filled trade, in the market's unit. */
  spread: number;
  overall: Stat;
  byBand: Stat[];
  bySession: Stat[];
  byDesk: Stat[];
  bySetup: Stat[];
  /** By what the live-trial pair checks said (feeds.checks); empty before any. */
  byCheck: Stat[];
  /** By the chart the signal came from (5-minute, 15-minute, …). */
  byTimeframe: Stat[];
  /** Shadow trades by why they weren't sent; null when there's no shadow table yet. */
  shadows: Stat[] | null;
  timing: TimingStats;
};

/** How late the alerts went out, and how long trades took (medians). */
export type TimingStats = {
  /** Auto-posted alerts with timing kept (feeds.timing). */
  alerts: number;
  /** Seconds from the entry candle closing to the alert going out. */
  delaySec: number | null;
  /** Seconds from the signal being built to it going out (the AI desk's check, mostly). */
  checkSec: number | null;
  /** How far price had moved from the entry by then, in the market's unit (+ is towards the take profit). */
  driftPips: number | null;
  /** Share of signals with a pending entry that filled. */
  fillRate: number | null;
  /** Minutes from the signal to the fill (pending entries). */
  fillMin: number | null;
  /** Minutes from the fill to the take profit, and to the stop loss. */
  winMin: number | null;
  lossMin: number | null;
  /** Trades closed on a learned time stop. */
  timeStops: number;
};

export type SignalReport = { days: number; markets: MarketReport[]; at: string };

export type LiveRow = {
  market: string;
  label: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  pip: number | null;
  decimals: number;
  status: string;
  best_target: number;
  confidence_pct: number;
  created_at: string;
  timeframe?: string | null;
  entered_at?: string | null;
  closed_at?: string | null;
  feeds: {
    bias?: boolean;
    desk?: string;
    setup?: string;
    checks?: { dollar?: string; flow?: string };
    holdFor?: number;
    timing?: { candleAt?: number; builtAt?: number; postedAt?: number; pricePosted?: number };
  } | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

/** Timing for one market's signals (pure). */
export function timingStats(rows: LiveRow[], size: number): TimingStats {
  const mins = (a?: string | null, b?: string | null) => {
    const x = Date.parse(a ?? "");
    const y = Date.parse(b ?? "");
    return Number.isFinite(x) && Number.isFinite(y) && y >= x ? (y - x) / 60_000 : NaN;
  };
  const timed = rows.filter((r) => r.feeds?.timing?.postedAt);
  const delay: number[] = [];
  const check: number[] = [];
  const drift: number[] = [];
  for (const r of timed) {
    const t = r.feeds!.timing!;
    if (t.candleAt) delay.push((t.postedAt! - t.candleAt) / 1000);
    if (t.builtAt) check.push((t.postedAt! - t.builtAt) / 1000);
    if (t.pricePosted)
      drift.push(((t.pricePosted - Number(r.entry)) * (r.direction === "BUY" ? 1 : -1)) / size);
  }
  // Pending entries: filled within a few seconds of the signal is a market entry.
  const waited = rows.filter(
    (r) => r.status === "unfilled" || mins(r.created_at, r.entered_at) >= 0.5,
  );
  const filledLate = waited.filter((r) => r.entered_at);
  const won = rows.filter((r) => /^tp[123]$/.test(r.status));
  const lost = rows.filter((r) => r.status === "stopped");
  const fin = (xs: LiveRow[]) =>
    median(xs.map((r) => mins(r.entered_at, r.closed_at)).filter(Number.isFinite));
  return {
    alerts: timed.length,
    delaySec: median(delay),
    checkSec: median(check),
    driftPips: drift.length
      ? Math.round((drift.reduce((a, b) => a + b, 0) / drift.length) * 10) / 10
      : null,
    fillRate: waited.length ? filledLate.length / waited.length : null,
    fillMin: median(filledLate.map((r) => mins(r.created_at, r.entered_at))),
    winMin: fin(won),
    lossMin: fin(lost),
    timeStops: rows.filter((r) => r.status === "expired" && Number(r.feeds?.holdFor) > 0).length,
  };
}

export type ShadowDone = {
  market: string;
  label: string;
  reason: string;
  outcome: "win" | "loss" | "flat" | "unfilled";
  pips: number | null;
  pip: number | null;
};

const BANDS: [string, number, number][] = [
  ["51–59%", 51, 59],
  ["60–69%", 60, 69],
  ["70–79%", 70, 79],
  ["80–90%", 80, 100],
];

const CHECK_NAMES: Record<string, string> = {
  "dollar:with": "US dollar with it",
  "dollar:flat": "US dollar steady",
  "dollar:against": "US dollar against it",
  "flow:with": "Order flow with it",
  "flow:flat": "Order flow even",
  "flow:against": "Order flow against it",
};

const DESK: Record<string, string> = {
  backed: "AI desk backed it",
  unanimous: "Every AI agreed (scout)",
  no_ai: "No AI answered",
  none: "Not checked (member asks)",
};

type Tally = {
  wins: number;
  losses: number;
  pips: number;
  filled: number;
  unfilled: number;
  flat: number;
};
const empty = (): Tally => ({ wins: 0, losses: 0, pips: 0, filled: 0, unfilled: 0, flat: 0 });
const r1 = (n: number) => Math.round(n * 10) / 10;

function stat(label: string, t: Tally, spread: number, shadow = false): Stat {
  const decided = t.wins + t.losses;
  return {
    label,
    wins: t.wins,
    losses: t.losses,
    winRate: decided ? t.wins / decided : null,
    pips: r1(t.pips),
    netPips: r1(t.pips - spread * t.filled),
    ...(shadow ? { unfilled: t.unfilled, flat: t.flat } : {}),
  };
}

/** The report from rows already loaded (pure, so it can be tested). */
export function buildReport(
  live: LiveRow[],
  shadows: ShadowDone[] | null,
  days: number,
  now = Date.now(),
): SignalReport {
  // The same setup sent to several chats is one signal.
  const setups = new Map<string, { row: LiveRow; best: number; stopped: boolean }>();
  for (const s of live) {
    if (s.feeds?.bias) continue;
    const key = setupKey({ ...s, id: "" });
    const seen = setups.get(key) ?? { row: s, best: 0, stopped: false };
    seen.best = Math.max(seen.best, Number(s.best_target) || 0);
    seen.stopped ||= s.status === "stopped";
    // An auto-post's desk verdict wins over a plain copy of the same setup.
    if (s.feeds?.desk && !seen.row.feeds?.desk) seen.row = s;
    setups.set(key, seen);
  }

  const markets = new Map<
    string,
    {
      label: string;
      unit: string;
      size: number;
      overall: Tally;
      groups: Record<"band" | "session" | "desk" | "setup" | "check" | "frame", Map<string, Tally>>;
      shadows: Map<string, Tally>;
    }
  >();
  const marketOf = (code: string, label: string, pip: number | null) => {
    let m = markets.get(code);
    if (!m) {
      const size = Number(pip) > 0 ? Number(pip) : 1;
      m = {
        label,
        unit: Number(pip) > 0 ? "pips" : "points",
        size,
        overall: empty(),
        groups: {
          band: new Map(),
          session: new Map(),
          desk: new Map(),
          setup: new Map(),
          check: new Map(),
          frame: new Map(),
        },
        shadows: new Map(),
      };
      markets.set(code, m);
    }
    return m;
  };
  const add = (map: Map<string, Tally>, key: string, win: boolean, pips: number) => {
    const t = map.get(key) ?? empty();
    if (win) t.wins++;
    else t.losses++;
    t.pips += pips;
    t.filled++;
    map.set(key, t);
  };

  for (const { row, best, stopped } of setups.values()) {
    const r = resultFor({ ...row, id: "" }, best, stopped && best === 0);
    if (!r) continue; // still running, cancelled or timed out flat
    const m = marketOf(row.market, row.label, row.pip);
    const win = r.outcome === "win";
    const conf = Number(row.confidence_pct) || 0;
    const band = BANDS.find(([, lo, hi]) => conf >= lo && conf <= hi)?.[0] ?? "Under 51%";
    add(new Map([["all", m.overall]]), "all", win, r.pips);
    add(m.groups.band, band, win, r.pips);
    add(m.groups.session, ukSession(Date.parse(row.created_at)), win, r.pips);
    add(m.groups.desk, row.feeds?.desk ?? "none", win, r.pips);
    add(m.groups.setup, row.feeds?.setup ?? "Main chart engine", win, r.pips);
    add(m.groups.frame, row.timeframe ?? "?", win, r.pips);
    for (const [check, verdict] of Object.entries(row.feeds?.checks ?? {}))
      if (verdict) add(m.groups.check, `${check}:${verdict}`, win, r.pips);
  }

  for (const s of shadows ?? []) {
    const m = marketOf(s.market, s.label, s.pip);
    const t = m.shadows.get(s.reason) ?? empty();
    if (s.outcome === "unfilled") t.unfilled++;
    else {
      t.filled++;
      t.pips += Number(s.pips) || 0;
      if (s.outcome === "win") t.wins++;
      else if (s.outcome === "loss") t.losses++;
      else t.flat++;
    }
    m.shadows.set(s.reason, t);
  }

  // Known groups in their usual order, then anything else seen.
  const order = (
    map: Map<string, Tally>,
    keys: string[],
    name: (k: string) => string,
    spread: number,
    shadow = false,
  ) =>
    [...keys.filter((k) => map.has(k)), ...[...map.keys()].filter((k) => !keys.includes(k))].map(
      (k) => stat(name(k), map.get(k)!, spread, shadow),
    );

  return {
    days,
    at: new Date(now).toISOString(),
    markets: [...markets.entries()]
      .sort(([a], [b]) => (a === "XAUUSD" ? -1 : b === "XAUUSD" ? 1 : a.localeCompare(b)))
      .map(([code, m]) => {
        const spread = r1((SPREAD_COST[code] ?? 0) / m.size);
        // Timing over this market's signals (bias calls left out, one per setup).
        const rows = [...setups.values()].map((x) => x.row).filter((r) => r.market === code);
        return {
          market: code,
          label: m.label,
          timing: timingStats(rows, m.size),
          unit: m.unit,
          spread,
          overall: stat("All signals", m.overall, spread),
          byBand: order(
            m.groups.band,
            BANDS.map(([b]) => b),
            (k) => k,
            spread,
          ),
          bySession: order(
            m.groups.session,
            SESSIONS.map((s) => s.id),
            (k) => SESSIONS.find((s) => s.id === k)?.name ?? k,
            spread,
          ),
          byDesk: order(m.groups.desk, Object.keys(DESK), (k) => DESK[k] ?? k, spread),
          bySetup: order(m.groups.setup, ["Main chart engine"], (k) => k, spread),
          byTimeframe: order(
            m.groups.frame,
            ["5M", "15M", "1M", "1H"],
            (k) =>
              ({ "5M": "5-minute", "15M": "15-minute", "1M": "1-minute", "1H": "1-hour" })[k] ?? k,
            spread,
          ),
          byCheck: order(
            m.groups.check,
            Object.keys(CHECK_NAMES),
            (k) => CHECK_NAMES[k] ?? k,
            spread,
          ),
          shadows:
            shadows === null
              ? null
              : order(
                  m.shadows,
                  Object.keys(SHADOW_REASONS),
                  (k) => SHADOW_REASONS[k as ShadowReason] ?? k,
                  spread,
                  true,
                ),
        };
      }),
  };
}

/** All rows of a query, a page at a time (up to 20,000). */
async function allRows<T>(
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** The report for the last `days` days. */
export async function signalReport(admin: Admin, days: number, now = Date.now()) {
  const since = new Date(now - days * 86_400_000).toISOString();
  const live = await allRows<LiveRow>((a, b) =>
    admin
      .from("trade_signals")
      .select(
        "market, label, direction, entry, stop, tp1, tp2, tp3, pip, decimals, status, best_target, confidence_pct, created_at, timeframe, entered_at, closed_at, feeds",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(a, b),
  );
  let shadows: ShadowDone[] | null = null;
  try {
    shadows = await allRows<ShadowDone>((a, b) =>
      admin
        .from("signal_shadows")
        .select("market, label, reason, outcome, pips, pip")
        .gte("created_at", since)
        .not("outcome", "is", null)
        .order("created_at", { ascending: true })
        .range(a, b),
    );
  } catch {
    shadows = null; // no shadow table yet
  }
  return buildReport(live, shadows, days, now);
}
