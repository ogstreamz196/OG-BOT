/**
 * The bot's own results book. Every signal that hits a target or its stop
 * loss is written to signal_results as it happens (by the signal watcher), so
 * OG B0T can answer "how much did we make today / yesterday / since the
 * weekend" from real numbers instead of guessing.
 *
 * A win is a signal that hit at least its Quick Scalp; its pips run to the
 * furthest target it reached (a later slide back to entry doesn't undo the
 * banked target). A loss is a signal whose stop loss was hit first; its pips
 * are the full stop distance. Signals that ran out of time, never filled or
 * were called off count as neither. The same setup sent to several chats
 * (channel, group, private) counts once.
 *
 * Pips use the market's pip size (gold 0.1); markets without one (bitcoin)
 * are counted in points of $1.
 */

type Admin = any;

const RESULTS = "signal_results";
const DAY = 24 * 3600_000;

export type ResultRow = {
  setup_key: string;
  market: string;
  label: string;
  direction: "BUY" | "SELL";
  outcome: "win" | "loss";
  best_target: number;
  pips: number;
  unit: "pips" | "points";
  decided_at: string;
};

type Signal = {
  id: string;
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
};

/** The result so far for a signal, or null while it's neither a win nor a loss. */
export function resultFor(
  s: Signal,
  bestTarget: number,
  stopped: boolean,
): Pick<ResultRow, "outcome" | "best_target" | "pips" | "unit"> | null {
  const size = Number(s.pip) > 0 ? Number(s.pip) : 1;
  const unit = Number(s.pip) > 0 ? "pips" : "points";
  const entry = Number(s.entry);
  const round = (n: number) => Math.round(n * 10) / 10;
  if (bestTarget >= 1) {
    const target = Number([s.tp1, s.tp2, s.tp3][Math.min(bestTarget, 3) - 1]);
    return {
      outcome: "win",
      best_target: bestTarget,
      pips: round(Math.abs(target - entry) / size),
      unit,
    };
  }
  if (stopped)
    return {
      outcome: "loss",
      best_target: 0,
      pips: round(-Math.abs(entry - Number(s.stop)) / size),
      unit,
    };
  return null;
}

/** One key per setup, so the same signal sent to several chats counts once. */
export function setupKey(s: Signal): string {
  const dp = Math.max(0, Math.min(8, Number(s.decimals) || 2));
  return [s.market, s.direction, Number(s.entry).toFixed(dp), Number(s.stop).toFixed(dp)].join("|");
}

/** Writes (or improves) a signal's result. Never throws. */
export async function recordResult(
  admin: Admin,
  s: Signal,
  bestTarget: number,
  stopped: boolean,
  at: number,
) {
  const r = resultFor(s, bestTarget, stopped);
  if (!r) return;
  const key = setupKey(s);
  try {
    const { data: existing, error } = await admin
      .from(RESULTS)
      .select("best_target, outcome")
      .eq("setup_key", key)
      .maybeSingle();
    if (error) return;
    if (existing) {
      // Only ever moves up: a further target on a win.
      if (r.outcome === "win" && r.best_target > Number(existing.best_target)) {
        await admin
          .from(RESULTS)
          .update({ ...r, updated_at: new Date(at).toISOString() })
          .eq("setup_key", key);
      }
      return;
    }
    await admin.from(RESULTS).insert({
      setup_key: key,
      signal_id: s.id,
      market: s.market,
      label: s.label,
      direction: s.direction,
      ...r,
      decided_at: new Date(at).toISOString(),
      updated_at: new Date(at).toISOString(),
    });
  } catch (e) {
    console.warn("[signals] result not recorded", (e as Error).message);
  }
}

/* ── Answering "how much did we make" ─────────────────────────────────── */

/** Whether a message asks how the signals did. */
export function asksAboutResults(text: string): boolean {
  return (
    /\bhow (much|many)\b.*\b(make|made|win|won|lose|lost|pips?|points?|profit|bank|banked|trades?|signals?)\b/i.test(
      text,
    ) ||
    /\b(results?|profits?|pips|win rate|scoreboard|p\s?&\s?l|pnl)\b.*\b(today|yesterday|week|weekend|month|signals?|trades?)\b/i.test(
      text,
    ) ||
    /\b(today|yesterday|this week|since (the )?weekend|this month)\b.*\b(results?|profits?|pips|won|lost|made)\b/i.test(
      text,
    )
  );
}

const ukParts = (ms: number) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    day: Number(get("day")),
    weekday: get("weekday"),
    sinceMidnight:
      (Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second"))) * 1000 +
      (ms % 1000),
  };
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** UK midnight at the start of the day holding `ms`. */
const ukMidnight = (ms: number) => ms - ukParts(ms).sinceMidnight;

/** The periods people ask about, in UK time: [label, from, to]. */
export function resultPeriods(now: number): [string, number, number][] {
  const p = ukParts(now);
  const today = now - p.sinceMidnight;
  // Step whole days back from midday, so a clock change can't shift the day.
  const daysBack = (n: number) => ukMidnight(today + 12 * 3600_000 - n * DAY);
  const dow = WEEKDAYS.indexOf(p.weekday); // Mon = 0
  const monday = daysBack(dow);
  // The weekend just gone (or this one, at the weekend): from Saturday 00:00.
  const saturday = daysBack(dow >= 5 ? dow - 5 : dow + 2);
  const dayName = (ms: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(ms));
  return [
    [`Today (${dayName(now)})`, today, now],
    [`Yesterday (${dayName(daysBack(1))})`, daysBack(1), today],
    [`Since the weekend (from ${dayName(saturday)})`, saturday, now],
    [`This week (from ${dayName(monday)})`, monday, now],
    ["Last 7 days", now - 7 * DAY, now],
    [`This month (from the 1st)`, daysBack(p.day - 1), now],
  ];
}

/** One period's line: wins, losses and the pips per market. */
export function summarise(rows: ResultRow[], label: string): string {
  if (!rows.length) return `- ${label}: no trades hit a target or a stop loss.`;
  const wins = rows.filter((r) => r.outcome === "win").length;
  const losses = rows.length - wins;
  const byMarket = new Map<string, { label: string; unit: string; pips: number }>();
  for (const r of rows) {
    const m = byMarket.get(r.market) ?? { label: r.label, unit: r.unit, pips: 0 };
    m.pips += Number(r.pips);
    byMarket.set(r.market, m);
  }
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${(Math.round(n * 10) / 10).toFixed(1)}`;
  const markets = [...byMarket.values()].map((m) => `${m.label} ${sign(m.pips)} ${m.unit}`);
  return `- ${label}: ${wins} won (hit a target), ${losses} lost (stop loss hit) · ${markets.join(" · ")}`;
}

/**
 * The results book for the AI, when someone asks how the signals did. Empty
 * when there's nothing to say (no table yet, or it couldn't be read).
 */
export async function signalResultsNote(admin: Admin, now = Date.now()): Promise<string> {
  const periods = resultPeriods(now);
  const from = Math.min(...periods.map((p) => p[1]));
  try {
    const { data, error } = await admin
      .from(RESULTS)
      .select("setup_key, market, label, direction, outcome, best_target, pips, unit, decided_at")
      .gte("decided_at", new Date(from).toISOString())
      .order("decided_at", { ascending: true })
      .limit(2000);
    if (error) return "";
    const rows = (data ?? []) as ResultRow[];
    const lines = periods.map(([label, a, b]) =>
      summarise(
        rows.filter((r) => {
          const t = Date.parse(r.decided_at);
          return t >= a && t < b;
        }),
        label,
      ),
    );
    const { signalRecord, recordText } = await import("./signal-record.server");
    const record = await signalRecord(admin);
    const recordLine = record
      ? `\n- The signal record (counted since the Boss last reset it; it never resets by itself; the headline % is the win rate, won vs lost): ${recordText(record).replace(/\n/g, " · ")}`
      : "";
    // What it has learned from replaying its own setups (signal-learning.server.ts).
    const { learningState } = await import("./signal-learning.server");
    const lessons = Object.values((await learningState()).markets)
      .map((m) => m.lesson)
      .filter(Boolean);
    const learnedLine = lessons.length
      ? `\n- What the bot has learned from replaying its own recent signals (it keeps studying when it's quiet and adjusts its stop room, how far targets are pulled in and the lowest confidence it trades): ${lessons.join(" ")}`
      : "";
    return (
      "\n\nSIGNAL RESULTS (the bot's own record of its gold and bitcoin signals, UK time; answer from these exact figures, never invent or round them up, " +
      "and say plainly when it's a loss. Won = hit at least the Quick Scalp, pips to the furthest target reached; lost = stop loss hit first. " +
      "Gold is in pips (0.1), bitcoin in $1 points; don't add the two together):\n" +
      lines.join("\n") +
      recordLine +
      learnedLine
    );
  } catch {
    return "";
  }
}

/* ── Today's score, shown at the bottom of the signals chat ───────────── */

/**
 * Today's wins, losses and pips per market (UK day) for the scoreboard, or
 * "" when nothing has closed yet (the scoreboard then shows only the record).
 */
export function scoreText(rows: ResultRow[]): string {
  if (!rows.length) return "";
  const wins = rows.filter((r) => r.outcome === "win").length;
  const losses = rows.length - wins;
  const byMarket = new Map<string, { label: string; unit: string; pips: number }>();
  for (const r of rows) {
    const m = byMarket.get(r.market) ?? { label: r.label, unit: r.unit, pips: 0 };
    m.pips += Number(r.pips);
    byMarket.set(r.market, m);
  }
  const sign = (n: number) =>
    `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 10) / 10).toFixed(1)}`;
  const markets = [...byMarket.values()].map(
    (m) => `${m.pips >= 0 ? "🟢" : "🔴"} ${m.label} ${sign(m.pips)} ${m.unit}`,
  );
  return `📊 TODAY'S SCORE · ✅ ${wins} won · 🛑 ${losses} lost\n${markets.join(" · ")}`;
}

/** Today's score ("" when nothing has closed yet), or null when the results can't be read. */
export async function todayScore(admin: Admin, now = Date.now()): Promise<string | null> {
  const [, from] = resultPeriods(now)[0];
  try {
    const { data, error } = await admin
      .from(RESULTS)
      .select("setup_key, market, label, direction, outcome, best_target, pips, unit, decided_at")
      .gte("decided_at", new Date(from).toISOString())
      .limit(1000);
    if (error) return null;
    return scoreText((data ?? []) as ResultRow[]);
  } catch {
    return null;
  }
}

/** UK midnight at the start of today, for telling when the score needs a fresh day. */
export const ukDayStart = (now: number) => resultPeriods(now)[0][1];
