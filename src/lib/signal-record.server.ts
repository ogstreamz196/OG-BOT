// The signal record: every gold and bitcoin signal OG B0T gives, whatever its
// confidence (members' requests and auto-posts alike, never market-bias
// calls; the Boss's choice, it used to be 70%+ only), and how
// they did, counted from the last time the Boss reset it. It never resets on
// its own: only the Boss's Reset button moves the start date
// (site_content "signals.record.resetAt").
//
// Every signal counted lands in exactly one bucket, so they always add up:
// won (hit at least the Quick Scalp), lost (stop loss first), still running,
// or a cancelled order (the entry was never reached). Signals that entered
// but timed out flat (no target, no stop) aren't counted at all.
// Outcomes come straight from each signal's own tracked status, so signals
// sent before the results book existed still count.
import { resultFor, setupKey } from "./signal-results.server";

type Admin = any;

/** Every signal counts (the Boss's choice); it used to be 70. */
export const RECORD_MIN_CONFIDENCE = 0;
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
  /** Cancelled orders: ran out of time (or was called off) before the entry was reached. */
  cancelled: number;
  markets: { market: string; label: string; unit: string; pips: number }[];
  /** Won and lost signals in the order they were sent, oldest first. */
  form: ("won" | "lost")[];
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
    signals: 0,
    wins: 0,
    losses: 0,
    running: 0,
    cancelled: 0,
    markets: [],
    form: [],
  };
  const byMarket = new Map<string, { market: string; label: string; unit: string; pips: number }>();
  for (const { row, best, stopped, active, filled } of setups.values()) {
    const result = resultFor({ ...row, id: "" }, best, stopped && best === 0);
    if (result) {
      if (result.outcome === "win") record.wins++;
      else record.losses++;
      record.form.push(result.outcome === "win" ? "won" : "lost");
      const m = byMarket.get(row.market) ?? {
        market: row.market,
        label: row.label,
        unit: result.unit,
        pips: 0,
      };
      m.pips += result.pips;
      byMarket.set(row.market, m);
    } else if (active) record.running++;
    else if (filled)
      continue; // timed out flat: left out of the record
    else record.cancelled++;
    record.signals++;
  }
  record.markets = [...byMarket.values()].map((m) => ({
    ...m,
    pips: Math.round(m.pips * 10) / 10,
  }));
  return record;
}

/** The record of every signal since the Boss's last reset, or null when it can't be read. */
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
  // The headline number is the win rate (won vs lost); the 70% confidence
  // rule is only how signals get into the record, so members never see it.
  const decided = r.wins + r.losses;
  const head = decided ? `${Math.round((r.wins / decided) * 100)}% WIN RATE` : "SIGNAL RECORD";
  const lines = [
    `🏆 ${head}${r.since ? ` since ${ukDate(r.since)}` : ""} · ${r.signals} signal${r.signals === 1 ? "" : "s"}`,
    `✅ ${r.wins} won · 🛑 ${r.losses} lost`,
  ];
  const rest = [
    r.running ? `⏳ ${r.running} running` : "",
    r.cancelled ? `🚫 ${r.cancelled} cancelled order${r.cancelled === 1 ? "" : "s"}` : "",
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

/** The run the record ends on: how many in a row, won or lost. Null before any. */
export function currentStreak(r: Pick<SignalRecord, "form">) {
  const last = r.form.at(-1);
  if (!last) return null;
  let count = 0;
  for (let i = r.form.length - 1; i >= 0 && r.form[i] === last; i--) count++;
  return { result: last, count };
}

/**
 * The signals chat's results post: OG B0T announcing the OG Trade Bot's
 * record, with its current streak and recent form up top.
 */
const MARKET_NAMES: Record<string, string> = { XAUUSD: "🥇 Gold", BTCUSD: "₿ Bitcoin" };

const cash = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n)
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\.00$/, "")}`;

export function resultsAnnouncement(
  r: SignalRecord,
  /** The demo account's line (paper-account demoLine), when it's running. */
  demo?: string | null,
  /** Each market's demo profit or loss in dollars (paperByMarket), when it's running. */
  byMarket?: Record<string, number> | null,
  /**
   * Posted by the Copy Trader B0T (the Boss's split): its own heading, the
   * trades it's copying right now (copyingLine), and a plain streak line.
   */
  copy?: { copying: string[] } | null,
): string {
  // Clutter free (the Boss's choice): the streak, the form, the score, each
  // market in cash and the balance.
  const streak = currentStreak(r);
  const n = streak?.count ?? 0;
  const hype = copy
    ? !streak
      ? "🏁 Nothing settled yet"
      : streak.result === "won"
        ? n > 1
          ? `🔥 ${n} wins in a row`
          : "✅ Won the last one"
        : n > 1
          ? `🥶 ${n} losses in a row`
          : "🛑 Lost the last one"
    : !streak
      ? "🏁 Nothing settled yet"
      : streak.result === "won"
        ? n > 1
          ? `🔥 ${n} wins on the bounce. My boy's cooking!`
          : "✅ Won his last one. Back on it."
        : n > 1
          ? `🥶 ${n} losses on the bounce. He'll bounce back, he always does.`
          : "🛑 Took a loss on the last one. Shake it off, son.";
  const lastTen = r.form.slice(-10);
  const decided = r.wins + r.losses;
  return [
    copy ? "📋 COPY TRADER B0T" : "📣 OG TRADE BOT RESULTS",
    ...(copy?.copying ?? []),
    hype,
    ...(lastTen.length ? [lastTen.map((f) => (f === "won" ? "✅" : "🛑")).join("")] : []),
    // With the money lines below (the copied trades), the counter says it's
    // every signal OG B0T gives, so the two never look like they disagree.
    ...(decided
      ? [
          `🏆 ${Math.round((r.wins / decided) * 100)}% win rate · ✅ ${r.wins} · 🛑 ${r.losses}${demo ? " · every signal" : ""}`,
        ]
      : []),
    ...Object.entries(byMarket ?? {})
      .filter(([, v]) => Number.isFinite(v))
      .map(([m, v]) => `${MARKET_NAMES[m] ?? m} ${cash(v)}`),
    ...(demo ? [demo] : []),
  ].join("\n");
}
