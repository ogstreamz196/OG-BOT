// When to expect the next signal (the Boss, 2026-11-03: "improve the ability
// to do chart analysis with an estimate time frame on when to expect
// signal"). A "no signal" card says what the chart is waiting for and, from
// how often the signals bot has really posted at each hour of the day over
// the last week, when the next one is likely: free, no AI. Never throws; no
// history or nothing likely within a day means no estimate, never a guess.
import { waitReasonKind } from "./signal-shadows.server";

type Admin = any;

const HOUR = 3600_000;
/** Days of posted signals the estimate learns from. */
export const ETA_DAYS = 7;
/** Fewer posted signals than this and there's no estimate. */
export const ETA_MIN_SIGNALS = 5;
const STEP_MIN = 5;
const HORIZON_MIN = 24 * 60;

export type Eta = { lo: number; mid: number; hi: number };

/**
 * From when signals were posted (ms), when the next is likely: the 25%, 50%
 * and 75% points of the wait, in minutes, treating each hour of the day as
 * its own rate (signals at that hour per day over the period). Never sooner
 * than the chart's next candle close. Null with too little history or when
 * one isn't likely within a day. Pure.
 */
export function etaFromHistory(
  times: number[],
  now: number,
  frameMin: number,
  days = ETA_DAYS,
): Eta | null {
  const recent = times.filter((t) => t <= now && t > now - days * 24 * HOUR);
  if (recent.length < ETA_MIN_SIGNALS) return null;
  const perHour = new Array(24).fill(0);
  for (const t of recent) perHour[new Date(t).getUTCHours()] += 1 / days;
  const frameMs = frameMin * 60_000;
  const nextClose = Math.max(1, Math.ceil((Math.ceil(now / frameMs) * frameMs - now) / 60_000));
  const marks = [Math.LN2 / 2.4, Math.LN2, Math.LN2 * 2]; // ≈ 25%, 50%, 75%
  const found: number[] = [];
  let cum = 0;
  for (let m = 0; m < HORIZON_MIN && found.length < marks.length; m += STEP_MIN) {
    cum += (perHour[new Date(now + m * 60_000).getUTCHours()] * STEP_MIN) / 60;
    while (found.length < marks.length && cum >= marks[found.length]) found.push(m + STEP_MIN);
  }
  if (found.length < 2) return null;
  const [lo, mid, hi = HORIZON_MIN] = found.map((m) => Math.max(m, nextClose));
  return { lo, mid, hi: Math.max(hi, mid) };
}

const roundMin = (m: number) => (m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5);
const hours = (m: number) => {
  const h = Math.round((m / 60) * 2) / 2;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

/** "about 20–55 min", "about 1–3 hours". Pure. */
export function etaText(e: Eta): string {
  if (e.hi < 60) {
    const lo = roundMin(e.lo);
    const hi = Math.max(roundMin(e.hi), lo);
    return lo === hi ? `about ${lo} min` : `about ${lo}–${hi} min`;
  }
  if (e.lo < 60) return `about ${roundMin(e.lo)} min to ${hours(e.hi)} hours`;
  const lo = hours(e.lo);
  const hi = hours(e.hi);
  return lo === hi ? `about ${lo} hours` : `about ${lo}–${hi} hours`;
}

/** What the chart is waiting for, in a few words, from the engine's wait reason. Pure. */
export function waitingFor(waitReason: string | undefined): string {
  switch (waitReasonKind(waitReason)) {
    case "floor":
      return "a stronger setup";
    case "quiet":
      return "the market to wake up";
    case "losing_hours":
      return "a better time of day";
    case "choppy":
      return "a proper trend";
    case "mixed":
      return "the charts to line up";
    case "no_room":
      return "room to the next level";
    case "blackout":
      return "the news or rollover to pass";
    case "trial_check":
      return "the dollar or order flow to agree";
    case "spread":
      return "the spread to calm down";
    default:
      return "a clean setup";
  }
}

/** The "⏳ Waiting for … · next signal likely in …" line. Pure. */
export function etaLine(waitReason: string | undefined, eta: Eta | null): string {
  const what = `⏳ Waiting for ${waitingFor(waitReason)}`;
  return eta ? `${what} · next signal likely in ${etaText(eta)}` : what;
}

const cache = new Map<string, { at: number; times: number[] }>();
const CACHE_MS = 5 * 60_000;

/** When the signals bot posted for a market over ETA_DAYS (cached 5 minutes, read only). */
async function postedTimes(admin: Admin, market: string, now: number): Promise<number[]> {
  const hit = cache.get(market);
  if (hit && now - hit.at < CACHE_MS) return hit.times;
  const { data, error } = await admin
    .from("trade_signals")
    .select("created_at")
    .eq("sender_worker", "trade")
    .eq("market", market)
    .gte("created_at", new Date(now - ETA_DAYS * 24 * HOUR).toISOString())
    .limit(3000);
  if (error) throw new Error("read");
  const times = ((data ?? []) as { created_at: string }[])
    .map((r) => Date.parse(r.created_at))
    .filter(Number.isFinite);
  cache.set(market, { at: now, times });
  return times;
}

/** The estimate for a market and chart, or null. Never throws, and gives up after 2 seconds. */
export async function signalEta(
  market: string,
  frameMin: number,
  now = Date.now(),
): Promise<Eta | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const times = await Promise.race([
      postedTimes(supabaseAdmin, market, now),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 2_000)),
    ]);
    return etaFromHistory(times, now, frameMin);
  } catch {
    return null;
  }
}
