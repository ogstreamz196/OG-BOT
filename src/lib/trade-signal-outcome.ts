// What happened to a trade signal after it was sent: walks the 1-minute
// candles since the last check and moves the signal through its states.
// Pure, so it can be tested on made-up price paths. The watcher
// (trade-signal-tracker.server.ts) stores the result and tells the member.
//
// Rules (deliberately cautious, so the track record never flatters itself):
// - A limit entry fills when price trades back to it, a stop entry when
//   price breaks through it; a market entry is live from the start.
// - After TP1 the stop moves to the entry (the card tells members to do so).
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
  | "breakeven" // closed: back to entry after TP1
  | "expired" // closed: time up while in the trade
  | "unfilled" // closed: time up before the entry was reached
  | "cancelled"; // closed: the higher-timeframe trend flipped

export const ACTIVE_STATUSES: SignalStatus[] = ["pending", "open", "tp1", "tp2"];

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
};

export type OutcomeEvent = {
  kind: "filled" | "tp1" | "tp2" | "tp3" | "stopped" | "breakeven" | "expired" | "unfilled";
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
    const stopLevel = reached >= 1 ? signal.entry : signal.stop;
    if (touchesStop(c, stopLevel)) {
      status = reached >= 1 ? "breakeven" : "stopped";
      events.push({ kind: status, at: c.t, price: stopLevel });
      continue;
    }
    for (let i = reached; i < 3; i++) {
      if (!touchesTarget(c, signal.targets[i])) break;
      status = (["tp1", "tp2", "tp3"] as const)[i];
      events.push({ kind: status, at: c.t, price: signal.targets[i] });
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
  T extends Pick<TrackedSignal, "direction" | "entry" | "stop" | "targets">,
>(signal: T, half: number): T {
  if (!(half > 0)) return signal;
  const s = signal.direction === "BUY" ? 1 : -1;
  return {
    ...signal,
    entry: signal.entry - s * half,
    stop: signal.stop + s * half,
    targets: signal.targets.map((t) => t + s * half) as [number, number, number],
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
