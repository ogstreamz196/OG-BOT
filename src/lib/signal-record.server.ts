// The 70%+ record: every gold and bitcoin signal sent at 70% confidence or
// more (requests and auto-posts alike, never market-bias calls), and how
// they did, counted from the last time the Boss reset it. It never resets on
// its own: only the Boss's Reset button moves the start date
// (site_content "signals.record.resetAt").
import { setupKey, type ResultRow } from "./signal-results.server";

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
  feeds: { bias?: boolean } | null;
};

/** Counts from rows already loaded (pure, so it can be tested). */
export function tallyRecord(
  signals: SignalRow[],
  results: ResultRow[],
  since: string | null,
): SignalRecord {
  const keys = new Set(
    signals.filter((s) => !s.feeds?.bias).map((s) => setupKey({ ...s, id: "" })),
  );
  const decided = results.filter((r) => keys.has(r.setup_key));
  const wins = decided.filter((r) => r.outcome === "win").length;
  const byMarket = new Map<string, { label: string; unit: string; pips: number }>();
  for (const r of decided) {
    const m = byMarket.get(r.market) ?? { label: r.label, unit: r.unit, pips: 0 };
    m.pips += Number(r.pips);
    byMarket.set(r.market, m);
  }
  return {
    since,
    signals: keys.size,
    wins,
    losses: decided.length - wins,
    markets: [...byMarket.values()].map((m) => ({ ...m, pips: Math.round(m.pips * 10) / 10 })),
  };
}

/** The 70%+ record since the Boss's last reset, or null when it can't be read. */
export async function signalRecord(admin: Admin): Promise<SignalRecord | null> {
  try {
    const since = await recordSince(admin);
    const from = since ?? "1970-01-01T00:00:00Z";
    const signals = await allRows<SignalRow>((a, b) =>
      admin
        .from("trade_signals")
        .select("market, label, direction, entry, stop, tp1, tp2, tp3, pip, decimals, feeds")
        .gte("confidence_pct", RECORD_MIN_CONFIDENCE)
        .gte("created_at", from)
        .order("created_at", { ascending: true })
        .range(a, b),
    );
    const results = await allRows<ResultRow>((a, b) =>
      admin
        .from("signal_results")
        .select("setup_key, market, label, direction, outcome, best_target, pips, unit, decided_at")
        .gte("decided_at", from)
        .order("decided_at", { ascending: true })
        .range(a, b),
    );
    return tallyRecord(signals, results, since);
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

/** The record as one or two lines for the signals chat scoreboard. */
export function recordText(r: SignalRecord): string {
  const head = `🏆 70%+ RECORD${r.since ? ` since ${ukDate(r.since)}` : ""} · ${r.signals} signal${r.signals === 1 ? "" : "s"} · ✅ ${r.wins} won · 🛑 ${r.losses} lost`;
  if (!r.markets.length) return head;
  const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
  return `${head}\n${r.markets
    .map((m) => `${m.pips >= 0 ? "🟢" : "🔴"} ${m.label} ${sign(m.pips)} ${m.unit}`)
    .join(" · ")}`;
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
