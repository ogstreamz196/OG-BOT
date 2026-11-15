// Works through every stopped-out signal (the last 90 days first, then each
// new one once its time window has played out), a few per run, and keeps the
// tally of why they lost per market and strategy in site_content
// "signals.autopsy". Reads candles and counts only: it never changes a trade,
// a setting or any stored signal.

import {
  cleanAutopsy,
  emptyTally,
  lossAutopsy,
  type AutopsyState,
  type Candle1m,
} from "./signal-autopsy";

type Admin = { from: (t: string) => any };

export const AUTOPSY_KEY = "signals.autopsy";
const PER_RUN = 8;
const RUN_EVERY_MS = 2 * 60_000;
const FIRST_LOOK_DAYS = 90;
/** How long after the stop we watch for the target: the trade's own window, kept between these. */
const LOOK_MIN_MS = 30 * 60_000;
const LOOK_MAX_MS = 4 * 3_600_000;
let lastRun = 0;

type LossRow = {
  id: string;
  market: string;
  direction: string;
  entry: number;
  stop: number;
  tp1: number;
  created_at: string;
  entered_at: string | null;
  closed_at: string | null;
  expires_at: string;
  feeds: Record<string, unknown> | null;
};

async function minutes(symbol: string, from: number): Promise<Candle1m[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000&startTime=${from}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[][];
    return rows.map((r) => ({
      t: Number(r[0]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function loadAutopsy(admin: Admin): Promise<AutopsyState> {
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", AUTOPSY_KEY)
    .maybeSingle();
  try {
    return cleanAutopsy(JSON.parse((data as { value?: string } | null)?.value ?? "{}"));
  } catch {
    return cleanAutopsy({});
  }
}

/** A few more losses studied (from the watch route, when it's not busy). Never throws. */
export async function maybeStudyLosses(admin: Admin, now = Date.now()): Promise<string> {
  if (now - lastRun < RUN_EVERY_MS) return "waiting";
  lastRun = now;
  try {
    const state = await loadAutopsy(admin);
    const { SIGNAL_MARKETS } = await import("./signal-markets");
    const { strategyOf } = await import("./signal-random.server");
    const from = state.doneTo || now - FIRST_LOOK_DAYS * 86_400_000;
    const { data } = await admin
      .from("trade_signals")
      .select(
        "id, market, direction, entry, stop, tp1, created_at, entered_at, closed_at, expires_at, feeds",
      )
      .eq("sender_worker", "trade")
      .eq("status", "stopped")
      .in("market", [...SIGNAL_MARKETS])
      .gt("closed_at", new Date(from).toISOString())
      .order("closed_at", { ascending: true })
      .limit(PER_RUN);
    const rows = (data ?? []) as LossRow[];
    let studied = 0;
    for (const r of rows) {
      const closedAt = Date.parse(r.closed_at ?? "");
      const enteredAt = Date.parse(r.entered_at ?? r.created_at);
      if (!Number.isFinite(closedAt) || !Number.isFinite(enteredAt)) {
        state.doneTo = Math.max(state.doneTo, closedAt || 0);
        continue;
      }
      const window = Date.parse(r.expires_at) - enteredAt;
      const lookMs = Math.min(
        LOOK_MAX_MS,
        Math.max(LOOK_MIN_MS, Number.isFinite(window) ? window : 0),
      );
      // Wait until the time to reach the target has played out.
      if (closedAt + lookMs > now) break;
      const symbol = typeof r.feeds?.binance === "string" ? r.feeds.binance : null;
      const candles = symbol ? await minutes(symbol, enteredAt - 60_000) : [];
      // The chart didn't answer: try this one again next run rather than skip it.
      if (symbol && !candles.length) break;
      if (candles.length) {
        // Move the trade's levels onto the chart's scale (a gold token sits a
        // little off spot gold): the gap at the entry candle.
        const at = candles.find((c) => c.t >= enteredAt - 60_000) ?? candles[0];
        const gap = at.c - Number(r.entry);
        const kind = lossAutopsy({
          direction: r.direction === "SELL" ? "SELL" : "BUY",
          entry: Number(r.entry) + gap,
          stop: Number(r.stop) + gap,
          tp1: Number(r.tp1) + gap,
          enteredAt,
          closedAt,
          lookMs,
          candles,
        });
        if (kind) {
          const strat = strategyOf(r.feeds);
          const t = ((state.tally[r.market] ??= {})[strat] ??= emptyTally());
          t[kind]++;
          state.studied++;
          studied++;
        }
      }
      state.doneTo = Math.max(state.doneTo, closedAt);
    }
    state.updatedAt = now;
    await admin
      .from("site_content")
      .upsert(
        { key: AUTOPSY_KEY, value: JSON.stringify(state), updated_at: new Date(now).toISOString() },
        { onConflict: "key" },
      );
    return `studied ${studied}`;
  } catch (e) {
    console.warn("[autopsy]", e);
    return "error";
  }
}
