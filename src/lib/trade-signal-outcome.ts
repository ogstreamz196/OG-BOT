// What happened to a trade signal after it was sent: walks the 1-minute
// candles since the last check and moves the signal through its states.
// Pure, so it can be tested on made-up price paths. The watcher
// (trade-signal-tracker.server.ts) stores the result and tells the member.
//
// Rules (deliberately cautious, so the track record never flatters itself):
// - A limit entry fills when price trades back to it, a stop entry when
//   price breaks through it; a market entry is live from the start.
// - After TP1 the stop moves to the entry (the card tells members to do so),
//   or to the profit lock when the signal has one (PROFIT_LOCK).
// - If one candle touches both the stop and a target, the stop counts.
// - Unfilled limits and open trades end when the signal's time is up.

import type { Candle } from "./trade-signal";

export type SignalStatus =
  | "pending" // limit entry not reached yet
  | "open" // entered, no target yet
  | "tp1"
  | "tp2"
  | "tp3" // closed: full target
  | "stopped" // closed: stop hit before TP1
  | "breakeven" // closed: back to the moved stop (the entry, or the profit lock)
  | "expired" // closed: time up while in the trade
  | "unfilled" // closed: time up before the entry was reached
  | "cancelled"; // closed: the higher-timeframe trend flipped

export const ACTIVE_STATUSES: SignalStatus[] = ["pending", "open", "tp1", "tp2"];

/**
 * The Boss's profit lock: once price is 70% of the way from the entry to the
 * take profit, the stop moves to 30% of the way, so the trade banks a bit
 * even if it turns, with room (the 40% between) not to be knocked out by the
 * first wiggle.
 */
export const PROFIT_LOCK = { at: 0.7, keep: 0.3 } as const;

/**
 * Moving the take profit while a trade runs (one take profit, before it's
 * hit), always announced. Distances are in parts of the ORIGINAL take
 * profit's distance from the entry.
 * - Further out (extend): the last EXTEND_CANDLES closed minutes each closed
 *   further its way than the one before, and the last is within NEAR of the
 *   take profit: it moves EXTEND_BY further, never past MAX_REACH.
 * - In (pull): it got within NEAR of the take profit, has made no new best
 *   for STALL_MIN minutes and has given back PULLBACK of it: the take profit
 *   comes in to KEEP_UNDER short of that best (so the next push banks it),
 *   never nearer than MIN_REACH, and only once.
 * At most MAX_MOVES moves a trade.
 */
export const TP_MOVE = {
  MAX_MOVES: 2,
  NEAR: 0.15,
  EXTEND_CANDLES: 3,
  EXTEND_BY: 0.5,
  MAX_REACH: 2,
  STALL_MIN: 10,
  PULLBACK: 0.15,
  KEEP_UNDER: 0.1,
  MIN_REACH: 0.6,
} as const;

export type TpMove = { tp: number; kind: "extend" | "pull"; best: number };

/** A take profit move for an open trade, or null. Pure. */
export function tpMove(o: {
  direction: "BUY" | "SELL";
  entry: number;
  /** The take profit now. */
  tp: number;
  /** The take profit it was sent with. */
  tp0: number;
  /** Closed 1-minute candles since the entry filled, oldest first. */
  candles: Candle[];
  /** Moves made so far. */
  moves: { kind: "extend" | "pull" }[];
}): TpMove | null {
  const side = o.direction === "BUY" ? 1 : -1;
  const D = Math.abs(o.tp0 - o.entry);
  if (!(D > 0) || o.moves.length >= TP_MOVE.MAX_MOVES || o.candles.length < TP_MOVE.EXTEND_CANDLES)
    return null;
  const p = (px: number) => ((px - o.entry) * side) / D;
  const at = (n: number) => o.entry + side * D * n;
  const tpP = p(o.tp);
  const cs = o.candles;
  const lastP = p(cs[cs.length - 1].c);
  // Further out: still pushing hard, right by the take profit.
  const run = cs.slice(-TP_MOVE.EXTEND_CANDLES);
  const pushing = run.every(
    (c, i) => (c.c - c.o) * side > 0 && (i === 0 || p(c.c) > p(run[i - 1].c)),
  );
  if (pushing && lastP >= tpP - TP_MOVE.NEAR && lastP < tpP) {
    const next = Math.min(TP_MOVE.MAX_REACH, tpP + TP_MOVE.EXTEND_BY);
    if (next > tpP + 0.05) return { tp: at(next), kind: "extend", best: cs[cs.length - 1].c };
  }
  // In: came close, stalled, and pulled back.
  if (o.moves.some((m) => m.kind === "pull")) return null;
  let bestI = 0;
  let bestP = -Infinity;
  cs.forEach((c, i) => {
    const v = p(side > 0 ? c.h : c.l);
    if (v > bestP) ((bestP = v), (bestI = i));
  });
  const stalled = cs.length - 1 - bestI >= TP_MOVE.STALL_MIN;
  if (bestP >= tpP - TP_MOVE.NEAR && stalled && lastP <= bestP - TP_MOVE.PULLBACK) {
    const next = bestP - TP_MOVE.KEEP_UNDER;
    if (next >= TP_MOVE.MIN_REACH && next < tpP - 0.02 && next > lastP + 0.05)
      return { tp: at(next), kind: "pull", best: side > 0 ? cs[bestI].h : cs[bestI].l };
  }
  return null;
}

/**
 * Open take profit with a trailing stop (some trades, the Boss's ask): no
 * fixed take profit to aim at, only a far cap (CAP risks) so the broker side
 * still has one. Once price is a full risk in profit the stop moves to the
 * entry, then follows GAP risks behind the best price, never back.
 */
export const TRAIL = { CAP: 3, GAP: 1 } as const;

/** Which trades trail: the surest ones (MIN_CONFIDENCE+) going with the bigger timeframe. */
export const TRAIL_MIN_CONFIDENCE = 80;

export function trailsThis(confidencePct: number, direction: "BUY" | "SELL", higher?: string) {
  return (
    confidencePct >= TRAIL_MIN_CONFIDENCE &&
    higher === (direction === "BUY" ? "bullish" : "bearish")
  );
}

/** Where the profit lock triggers and where it puts the stop, or null for a bad take profit. */
export function profitLock(
  direction: "BUY" | "SELL",
  entry: number,
  tp: number,
): { trigger: number; stop: number } | null {
  const d = tp - entry;
  if (!Number.isFinite(d) || d === 0 || Math.sign(d) !== (direction === "BUY" ? 1 : -1))
    return null;
  return { trigger: entry + d * PROFIT_LOCK.at, stop: entry + d * PROFIT_LOCK.keep };
}

/**
 * Which of a chat's signal messages a new signal may delete: never a card
 * still in play (pending, open, a target hit and still running), nor anything
 * after the oldest one in play (its follow-ups); finished cards always go.
 * Telegram message ids only grow within a chat, which is what makes "after"
 * work. `tracked` is every card and update remembered for the chat.
 */
export function oldSignalMessages(opts: {
  tracked: number[];
  active: number[];
  finished: number[];
  keep: number[];
}): number[] {
  const active = new Set(opts.active);
  const keep = new Set(opts.keep);
  const finished = new Set(opts.finished);
  const floor = opts.active.length ? Math.min(...opts.active) : Infinity;
  const all = new Set([...opts.tracked, ...opts.finished]);
  return [...all]
    .filter((id) => !keep.has(id) && !active.has(id) && (finished.has(id) || id < floor))
    .sort((a, b) => a - b);
}

export type TrackedSignal = {
  direction: "BUY" | "SELL";
  /**
   * How a pending entry fills: a limit when price comes back to it (the
   * default), a stop when price breaks through it to confirm the move.
   */
  entryType?: "limit" | "stop";
  entry: number;
  stop: number;
  targets: [number, number, number];
  status: SignalStatus;
  /** When the signal stops being valid (ms). */
  expiresAt: number;
  /**
   * Once price reaches this level (before any target), the stop moves to
   * `beStop` ("protected"): the profit lock, or an older learned breakeven.
   * `isProtected` says it already has.
   */
  beTrigger?: number;
  isProtected?: boolean;
  /** Where the moved stop sits: the entry (default), or the profit lock; broker-side when shifted. */
  beStop?: number;
  /**
   * A trailing stop (TRAIL): `risk` is the trade's first risk, `stop` where
   * the trailing stop is now (none until it's a full risk in profit).
   */
  trail?: { risk: number; stop?: number };
};

export type OutcomeEvent = {
  kind:
    | "filled"
    | "tp1"
    | "tp2"
    | "tp3"
    | "stopped"
    | "breakeven"
    | "expired"
    | "unfilled"
    | "protected"
    | "trailed";
  /** Candle time the event happened in (ms), or `now` for time-ups. */
  at: number;
  /** The level it happened at. */
  price: number;
};

export function isActive(status: SignalStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** How many targets the trade reached (0–3) for a status. */
export function targetsReached(status: SignalStatus): number {
  return status === "tp1" ? 1 : status === "tp2" ? 2 : status === "tp3" ? 3 : 0;
}

/**
 * Moves a signal along the candles (oldest first, already limited to the
 * ones not seen yet). Candles that start after the expiry are ignored; if
 * `now` is past the expiry and the signal is still active, it times out.
 */
export function advanceSignal(
  signal: TrackedSignal,
  candles: Candle[],
  now: number,
): { status: SignalStatus; events: OutcomeEvent[] } {
  const long = signal.direction === "BUY";
  const events: OutcomeEvent[] = [];
  let status = signal.status;
  let guarded = !!signal.isProtected || signal.trail?.stop != null;
  // Where a moved stop sits: the trailing stop, the profit lock, or the entry.
  let beStop = signal.trail?.stop ?? signal.beStop ?? signal.entry;
  const below = (c: Candle, level: number) => c.l <= level;
  const above = (c: Candle, level: number) => c.h >= level;
  const touchesStop = (c: Candle, level: number) => (long ? below(c, level) : above(c, level));
  const touchesTarget = (c: Candle, level: number) => (long ? above(c, level) : below(c, level));

  for (const c of candles) {
    if (!isActive(status) || c.t >= signal.expiresAt) break;
    if (status === "pending") {
      const buysLow = long === (signal.entryType !== "stop");
      const filled = buysLow ? below(c, signal.entry) : above(c, signal.entry);
      if (!filled) continue;
      status = "open";
      events.push({ kind: "filled", at: c.t, price: signal.entry });
      // Same candle: only the stop counts (we can't know the order inside it).
      if (touchesStop(c, signal.stop)) {
        status = "stopped";
        events.push({ kind: "stopped", at: c.t, price: signal.stop });
      }
      continue;
    }
    const reached = targetsReached(status);
    const atEntry = reached >= 1 || guarded;
    const stopLevel = atEntry ? beStop : signal.stop;
    if (touchesStop(c, stopLevel)) {
      status = atEntry ? "breakeven" : "stopped";
      events.push({ kind: status, at: c.t, price: stopLevel });
      continue;
    }
    for (let i = reached; i < 3; i++) {
      if (!touchesTarget(c, signal.targets[i])) break;
      status = (["tp1", "tp2", "tp3"] as const)[i];
      events.push({ kind: status, at: c.t, price: signal.targets[i] });
    }
    // The learned breakeven: far enough in profit (and no target yet), the
    // stop moves to the entry from the next candle on.
    if (
      !guarded &&
      signal.beTrigger != null &&
      targetsReached(status) === 0 &&
      isActive(status) &&
      touchesTarget(c, signal.beTrigger)
    ) {
      guarded = true;
      events.push({ kind: "protected", at: c.t, price: signal.beTrigger });
    }
    // A trailing stop: a full risk in profit, the stop to the entry, then
    // GAP risks behind the best price (from the next candle on, never back).
    const r = signal.trail?.risk ?? 0;
    if (r > 0 && status === "open") {
      const best = long ? c.h : c.l;
      if ((best - signal.entry) * (long ? 1 : -1) >= r) {
        const next = best - (long ? 1 : -1) * r * TRAIL.GAP;
        if (!guarded || (next - beStop) * (long ? 1 : -1) > 0) {
          guarded = true;
          beStop = next;
          events.push({ kind: "trailed", at: c.t, price: next });
        }
      }
    }
  }

  if (isActive(status) && now >= signal.expiresAt) {
    const kind = status === "pending" ? "unfilled" : "expired";
    events.push({ kind, at: now, price: NaN });
    status = kind;
  }
  return { status, events };
}

/**
 * A signal's levels as they're hit on mid-price candles at a broker quoting
 * a bid and an ask `half` either side: a buy fills on the ask and closes on
 * the bid (its entry needs the mid half a spread lower, its stop and take
 * profit half a spread higher), a sell the other way round. Prices shown and
 * results stay on the signal's own levels; only when they're reached moves.
 */
export function brokerLevels<
  T extends Pick<
    TrackedSignal,
    "direction" | "entry" | "stop" | "targets" | "beTrigger" | "beStop"
  >,
>(signal: T, half: number): T {
  if (!(half > 0)) return signal;
  const s = signal.direction === "BUY" ? 1 : -1;
  return {
    ...signal,
    entry: signal.entry - s * half,
    stop: signal.stop + s * half,
    targets: signal.targets.map((t) => t + s * half) as [number, number, number],
    // A stop moved to the entry is a stop like any other; the breakeven
    // trigger is reached like a target.
    beStop: (signal.beStop ?? signal.entry) + s * half,
    ...(signal.beTrigger != null ? { beTrigger: signal.beTrigger + s * half } : {}),
  };
}

/** Learned time limits on a trade (absolute deadline for the entry, then a hold). */
export type TimeLimits = {
  /** A pending entry not filled by this time (ms) is cancelled. */
  fillBy?: number;
  /** A filled trade still going this long (ms) after its fill is closed on time. */
  holdMs?: number;
};

/**
 * advanceSignal with time limits: the entry has to fill by `fillBy`, and once
 * in, the trade gets `holdMs` before it's closed on time (an "expired" event),
 * both inside the signal's own validity. `enteredAt` is when an already open
 * trade filled. Used by the live tracker and the learning replay alike.
 */
export function advanceTimed(
  signal: TrackedSignal & { enteredAt?: number },
  candles: Candle[],
  now: number,
  limits: TimeLimits = {},
): { status: SignalStatus; events: OutcomeEvent[] } {
  const end = signal.expiresAt;
  if (signal.status === "pending") {
    const deadline = Math.min(end, limits.fillBy ?? end);
    const first = advanceSignal({ ...signal, expiresAt: deadline }, candles, now);
    const fill = first.events.find((e) => e.kind === "filled");
    if (!fill) return first;
    const i = first.events.indexOf(fill);
    // Stopped on the very candle it filled: that's settled.
    if (first.events[i + 1]?.kind === "stopped" && first.events[i + 1].at === fill.at) return first;
    // In: follow on from the fill under the hold, not the entry's deadline.
    const rest = advanceTimed(
      { ...signal, status: "open", enteredAt: fill.at },
      candles.filter((c) => c.t > fill.at),
      now,
      { holdMs: limits.holdMs },
    );
    return { status: rest.status, events: [...first.events.slice(0, i + 1), ...rest.events] };
  }
  const until =
    limits.holdMs && signal.enteredAt != null
      ? Math.min(end, signal.enteredAt + limits.holdMs)
      : end;
  return advanceSignal({ ...signal, expiresAt: until }, candles, now);
}

/** The time limits stored with a signal (feeds.fillWithin / feeds.holdFor, in minutes). */
export function limitsFrom(
  feeds: { fillWithin?: unknown; holdFor?: unknown } | null | undefined,
  createdAt: number,
): TimeLimits {
  const fill = Number(feeds?.fillWithin);
  const hold = Number(feeds?.holdFor);
  return {
    ...(fill > 0 ? { fillBy: createdAt + fill * 60_000 } : {}),
    ...(hold > 0 ? { holdMs: hold * 60_000 } : {}),
  };
}

/* ── Track record ──────────────────────────────────────────────────────── */

export type ClosedSignal = { status: SignalStatus; best_target: number; entered: boolean };

/** Minimum filled-and-closed signals before a track record is shown. */
export const MIN_TRACK_RECORD = 5;

/**
 * One honest line on how past signals for this market and timeframe did,
 * or null when there aren't enough yet. Unfilled limits aren't trades, so
 * they don't count.
 */
export function trackRecordText(rows: ClosedSignal[], days: number): string | null {
  const filled = rows.filter((r) => r.entered && !isActive(r.status));
  if (filled.length < MIN_TRACK_RECORD) return null;
  const tp1 = filled.filter((r) => r.best_target >= 1).length;
  const stopped = filled.filter((r) => r.status === "stopped").length;
  const other = filled.length - tp1 - stopped;
  const pct = Math.round((tp1 / filled.length) * 100);
  const tail = other > 0 ? `, ${other} ended early or ran out of time` : "";
  return `last ${days} days, ${filled.length} signals filled: TP1 hit on ${tp1} (${pct}%), stopped out before TP1 on ${stopped}${tail}. Past results don't promise future ones.`;
}
