// The 70%+ record: every gold and bitcoin signal sent at 70% confidence or
// more (requests and auto-posts alike, never market-bias calls), and how
// they did, counted from the last time the Boss reset it. It never resets on
// its own: only the Boss's Reset button moves the start date
// (site_content "signals.record.resetAt").
//
// Every signal counted lands in exactly one bucket, so they always add up:
// won (hit at least the Quick Scalp), lost (stop loss first), still running,
// never hit its entry, or timed out (entered but no target or stop in time).
// Outcomes come straight from each signal's own tracked status, so signals
// sent before the results book existed still count.
import { resultFor, setupKey } from "./signal-results.server";

type Admin = any;

export const RECORD_MIN_CONFIDENCE = 70;
export const RECORD_RESET_KEY = "signals.record.resetAt";
const PAGE = 1000;
const MAX_ROWS = 50_000;

export type SignalRecord = {
  /** When counting started (the Boss's last reset), or null for all time. */
  since: string | null;
  signals: number;
  wins: number;
  losses: number;
  /** Still waiting for entry or in the trade, no target yet. */
  running: number;
  /** Ran out of time (or was called off) before the entry was reached. */
  untriggered: number;
  /** Entered, but no target and no stop before it ran out of time. */
  timedOut: number;
  markets: { label: string; unit: string; pips: number }[];
};

/** All rows of a query, a page at a time (up to MAX_ROWS). */
async function allRows<T>(
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** When the Boss last reset the record (ISO), or null if never. */
export async function recordSince(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", RECORD_RESET_KEY)
    .maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  return v && Number.isFinite(Date.parse(v)) ? v : null;
}

type SignalRow = {
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
  entered_at: string | null;
  feeds: { bias?: boolean } | null;
};

const ACTIVE = new Set(["pending", "open", "tp1", "tp2"]);
/** Statuses only reachable after the entry filled. */
const ENTERED = new Set(["open", "tp1", "tp2", "tp3", "stopped", "breakeven", "expired"]);

/** Counts from rows already loaded (pure, so it can be tested). */
export function tallyRecord(signals: SignalRow[], since: string | null): SignalRecord {
  // The same setup sent to several chats is one signal: merge what each copy saw.
  const setups = new Map<
    string,
    { row: SignalRow; best: number; stopped: boolean; active: boolean; filled: boolean }
  >();
  for (const s of signals) {
    if (s.feeds?.bias) continue;
    const key = setupKey({ ...s, id: "" });
    const seen = setups.get(key) ?? {
      row: s,
      best: 0,
      stopped: false,
      active: false,
      filled: false,
    };
    seen.best = Math.max(seen.best, Number(s.best_target) || 0);
    seen.stopped ||= s.status === "stopped";
    seen.active ||= ACTIVE.has(s.status);
    seen.filled ||= !!s.entered_at || ENTERED.has(s.status);
    setups.set(key, seen);
  }
  const record: SignalRecord = {
    since,
    signals: setups.size,
    wins: 0,
    losses: 0,
    running: 0,
    untriggered: 0,
    timedOut: 0,
    markets: [],
  };
  const byMarket = new Map<string, { label: string; unit: string; pips: number }>();
  for (const { row, best, stopped, active, filled } of setups.values()) {
    const result = resultFor({ ...row, id: "" }, best, stopped && best === 0);
    if (result) {
      if (result.outcome === "win") record.wins++;
      else record.losses++;
      const m = byMarket.get(row.market) ?? { label: row.label, unit: result.unit, pips: 0 };
      m.pips += result.pips;
      byMarket.set(row.market, m);
    } else if (active) record.running++;
    else if (filled) record.timedOut++;
    else record.untriggered++;
  }
  record.markets = [...byMarket.values()].map((m) => ({
    ...m,
    pips: Math.round(m.pips * 10) / 10,
  }));
  return record;
}

/** The 70%+ record since the Boss's last reset, or null when it can't be read. */
export async function signalRecord(admin: Admin): Promise<SignalRecord | null> {
  try {
    const since = await recordSince(admin);
    const from = since ?? "1970-01-01T00:00:00Z";
    const signals = await allRows<SignalRow>((a, b) =>
      admin
        .from("trade_signals")
        .select(
          "market, label, direction, entry, stop, tp1, tp2, tp3, pip, decimals, status, best_target, entered_at, feeds",
        )
        .gte("confidence_pct", RECORD_MIN_CONFIDENCE)
        .gte("created_at", from)
        .order("created_at", { ascending: true })
        .range(a, b),
    );
    return tallyRecord(signals, since);
  } catch (e) {
    console.warn("[signals] record read failed", e);
    return null;
  }
}

const ukDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

/** The record for the signals chat scoreboard: every signal in exactly one bucket. */
export function recordText(r: SignalRecord): string {
  const decided = r.wins + r.losses;
  const lines = [
    `🏆 70%+ RECORD${r.since ? ` since ${ukDate(r.since)}` : ""} · ${r.signals} signal${r.signals === 1 ? "" : "s"}`,
    `✅ ${r.wins} won · 🛑 ${r.losses} lost` +
      (decided ? ` · 🎯 ${Math.round((r.wins / decided) * 100)}% win rate` : ""),
  ];
  const rest = [
    r.running ? `⏳ ${r.running} running` : "",
    r.untriggered ? `🚫 ${r.untriggered} never hit entry` : "",
    r.timedOut ? `⌛ ${r.timedOut} timed out flat` : "",
  ].filter(Boolean);
  if (rest.length) lines.push(rest.join(" · "));
  if (r.markets.length) {
    const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
    lines.push(
      r.markets
        .map((m) => `${m.pips >= 0 ? "🟢" : "🔴"} ${m.label} ${sign(m.pips)} ${m.unit}`)
        .join(" · "),
    );
  }
  return lines.join("\n");
}

/** Boss only (checked by the caller): start counting again from now. */
export async function resetSignalRecord(admin: Admin, actorId: string): Promise<string> {
  const at = new Date().toISOString();
  const { error } = await admin
    .from("site_content")
    .upsert(
      { key: RECORD_RESET_KEY, value: at, updated_at: at, updated_by: actorId },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: actorId,
      action: "signal_record_reset",
      category: "signals",
      target_key: RECORD_RESET_KEY,
      metadata: { reset_at: at },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return at;
}
