// Shadow trades: the setups the bot did NOT send, followed silently so we can
// see whether each thing that blocks a signal is earning its place. Nothing
// here is ever posted, counted in the results book or the 70%+ record, or fed
// to the learning loop's live floor; it only feeds the Boss's signal report.
//
// What's shadowed (one per market per 5 minutes, so a 10-second scanner can't
// flood it): a chart setup under the 70% alert bar, a wait the engine chose
// (and why: under the confidence floor, too quiet, a losing time of day,
// choppy, mixed timeframes, no room), and every 70%+ alert the AI desk turned
// down. Each is followed on closed 1-minute candles with the tracker's rules
// (stop counts first, one take profit) until it wins, loses or runs out of time.
import type { SignalSummary } from "./trade-signal-context.server";

type Admin = any;

const TABLE = "signal_shadows";
const SLOT_MS = 5 * 60_000;
const MINUTE = 60_000;
/** The slots this server has already shadowed, so a 10-second scanner doesn't write each pass. */
const recorded = new Map<string, string>();

export type ShadowReason =
  | "below_alert"
  | "desk_no"
  | "floor"
  | "quiet"
  | "losing_hours"
  | "choppy"
  | "mixed"
  | "no_room"
  | "blackout"
  | "trial_check";

/** What the report calls each reason. */
export const SHADOW_REASONS: Record<ShadowReason, string> = {
  below_alert: "Under the 70% alert bar",
  desk_no: "AI desk said no",
  floor: "Under the learned confidence floor",
  quiet: "Too quiet",
  losing_hours: "Losing time of day",
  choppy: "Choppy (no trend)",
  mixed: "Timeframes disagree",
  no_room: "No room to the next level",
  blackout: "Blackout (rollover, big news, Friday close)",
  trial_check: "Pair check said no (dollar or order flow)",
};

/** Why the engine waited, as a shadow reason; null for waits worth nothing (closed, no spot price). */
export function waitReasonKind(waitReason: string | undefined): ShadowReason | null {
  const w = waitReason ?? "";
  if (/^Not strong enough/i.test(w)) return "floor";
  if (/^Too quiet/i.test(w)) return "quiet";
  if (/time of day has been losing/i.test(w)) return "losing_hours";
  if (/^No real trend/i.test(w)) return "choppy";
  if (/timeframes disagree/i.test(w)) return "mixed";
  if (/^Not enough room/i.test(w)) return "no_room";
  if (/^Rollover:|about to shut for the weekend|^Big US news/i.test(w)) return "blackout";
  if (/^Trial check:/i.test(w)) return "trial_check";
  return null;
}

type Summary = Pick<
  SignalSummary,
  | "market"
  | "label"
  | "timeframe"
  | "direction"
  | "confidencePct"
  | "entry"
  | "entryType"
  | "stop"
  | "targets"
  | "offset"
  | "validUntil"
  | "decimals"
  | "pip"
>;

/** Keeps a shadow of a setup that wasn't sent. Never throws; one per market per 5 minutes per kind. */
export async function recordShadow(
  admin: Admin,
  s: Summary | undefined,
  reason: ShadowReason,
  now = Date.now(),
): Promise<void> {
  if (!s || !(s.entry > 0) || !(s.stop > 0) || !(Number(s.targets?.[0]) > 0)) return;
  const expires = Date.parse(s.validUntil);
  if (!Number.isFinite(expires) || expires <= now) return;
  const slot = Math.floor(now / SLOT_MS);
  // The desk's no's are kept apart, so a scanner shadow in the same slot can't hide one.
  // 5-minute scalps keep their old keys; other timeframes get their own slots.
  const tf = s.timeframe && s.timeframe !== "5M" ? `${s.timeframe}:` : "";
  const key = `${s.market}:${tf}${reason === "desk_no" ? "desk:" : ""}${slot}`;
  const lane = `${s.market}:${tf}${reason === "desk_no" ? "desk" : "scan"}`;
  if (recorded.get(lane) === key) return;
  recorded.set(lane, key);
  const market = s.entryType === "market";
  try {
    await admin.from(TABLE).upsert(
      {
        key,
        market: s.market,
        label: s.label,
        timeframe: s.timeframe,
        direction: s.direction,
        entry: s.entry,
        entry_type: s.entryType,
        stop: s.stop,
        tp: Number(s.targets[0]),
        confidence_pct: Math.round(s.confidencePct),
        reason,
        decimals: s.decimals,
        pip: s.pip,
        offset: Number(s.offset) || 0,
        status: market ? "open" : "pending",
        entered_at: market ? new Date(now).toISOString() : null,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(expires).toISOString(),
      },
      { onConflict: "key", ignoreDuplicates: true },
    );
  } catch {
    /* no table yet: nothing shadowed */
  }
}

export type ShadowRow = {
  key: string;
  market: string;
  direction: "BUY" | "SELL";
  entry: number;
  entry_type: string;
  stop: number;
  tp: number;
  pip: number | null;
  offset: number;
  status: string;
  entered_at: string | null;
  last_candle_at: string | null;
  created_at: string;
  expires_at: string;
};

/** A shadow's result once it's over, in pips (points without a pip size). Pure. */
export function shadowResult(
  row: Pick<ShadowRow, "direction" | "entry" | "stop" | "tp" | "pip">,
  status: string,
  entered: boolean,
  lastPrice: number,
): { outcome: "win" | "loss" | "flat" | "unfilled"; pips: number } {
  const size = Number(row.pip) > 0 ? Number(row.pip) : 1;
  const side = row.direction === "BUY" ? 1 : -1;
  const pips = (to: number) => Math.round(((to - Number(row.entry)) * side * 10) / size) / 10;
  if (status === "tp3" || status === "tp2" || status === "tp1")
    return { outcome: "win", pips: pips(row.tp) };
  if (status === "stopped") return { outcome: "loss", pips: pips(row.stop) };
  if (!entered) return { outcome: "unfilled", pips: 0 };
  return { outcome: "flat", pips: Number.isFinite(lastPrice) ? pips(lastPrice) : 0 };
}

/**
 * One pass over the running shadows: new closed 1-minute candles, then fills,
 * the take profit, the stop and time-ups. Says how many it followed. Never throws.
 */
export async function followShadows(admin: Admin, now = Date.now()): Promise<string> {
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select(
        "key, market, direction, entry, entry_type, stop, tp, pip, offset, status, entered_at, last_candle_at, created_at, expires_at",
      )
      .in("status", ["pending", "open"])
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return "skipped: no shadow table";
    const rows = (data ?? []) as ShadowRow[];
    if (!rows.length) return "none running";
    const { advanceSignal, isActive } = await import("./trade-signal-outcome");
    const { candles } = await import("./trade-signal-context.server");
    const { detectTradeIntent } = await import("./trade-signal");
    const { shiftCandles } = await import("./trade-signal-extras");
    const byMarket = new Map<string, ShadowRow[]>();
    for (const r of rows) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r]);
    let closed = 0;
    for (const [market, group] of byMarket) {
      const inst = detectTradeIntent(`${market} signal 5m`);
      if (!inst) continue;
      const { data: raw } = await candles(inst, "1m").catch(() => ({ data: [] }));
      const done = raw.filter((c) => c.t + MINUTE <= now);
      for (const row of group) {
        const bars = shiftCandles(done, Number(row.offset) || 0);
        const from = Math.floor(Date.parse(row.created_at) / MINUTE) * MINUTE + MINUTE;
        const seen = row.last_candle_at ? Date.parse(row.last_candle_at) : -Infinity;
        const fresh = bars.filter((c) => c.t >= from && c.t > seen);
        const tp = Number(row.tp);
        const res = advanceSignal(
          {
            direction: row.direction,
            entryType: row.entry_type === "stop" ? "stop" : "limit",
            entry: Number(row.entry),
            stop: Number(row.stop),
            targets: [tp, tp, tp],
            status: row.status as "pending" | "open",
            expiresAt: Date.parse(row.expires_at),
          },
          fresh,
          now,
        );
        const update: Record<string, unknown> = {};
        if (fresh.length) update.last_candle_at = new Date(fresh.at(-1)!.t).toISOString();
        const filled = res.events.find((e) => e.kind === "filled");
        if (filled) update.entered_at = new Date(filled.at).toISOString();
        if (res.status !== row.status) update.status = res.status;
        if (!isActive(res.status)) {
          const entered = !!row.entered_at || !!filled;
          const r = shadowResult(
            row,
            res.status,
            entered,
            fresh.at(-1)?.c ?? bars.at(-1)?.c ?? NaN,
          );
          update.outcome = r.outcome;
          update.pips = r.pips;
          update.closed_at = new Date(now).toISOString();
          closed++;
        }
        if (Object.keys(update).length) await admin.from(TABLE).update(update).eq("key", row.key);
      }
    }
    // Old finished shadows go after 120 days.
    await admin
      .from(TABLE)
      .delete()
      .lt("created_at", new Date(now - 120 * 86_400_000).toISOString());
    return `${rows.length} running, ${closed} finished`;
  } catch (e) {
    console.warn("[signals] shadows failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}
