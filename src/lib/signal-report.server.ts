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
  /** Shadow trades by why they weren't sent; null when there's no shadow table yet. */
  shadows: Stat[] | null;
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
  feeds: { bias?: boolean; desk?: string; setup?: string } | null;
};

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
      groups: Record<"band" | "session" | "desk" | "setup", Map<string, Tally>>;
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
        groups: { band: new Map(), session: new Map(), desk: new Map(), setup: new Map() },
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
        return {
          market: code,
          label: m.label,
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
        "market, label, direction, entry, stop, tp1, tp2, tp3, pip, decimals, status, best_target, confidence_pct, created_at, feeds",
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
