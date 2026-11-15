// The scan log (the Boss, 2026-11-15: "no signals are getting sent"): what
// happened to every setup in each minute's scan, so "why no signal?" always
// has an answer on the Copy Trader B0T's card and the website. Pure and
// browser-safe; the server keeps the latest runs in site_content
// "signals.scanlog". Reads and counts only.

export const SCAN_OUTCOMES = [
  "posted",
  "waiting",
  "below_bar",
  "no_room",
  "held",
  "desk_no",
  "desk_late",
  "switched_off",
  "not_sent",
  "check_failed",
  "build_failed",
] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export type ScanNote = {
  market: string;
  frame: string;
  outcome: ScanOutcome;
  confidence?: number;
  detail?: string;
};

/** What each outcome means, in plain words, worst-to-fix first. */
export const OUTCOME_LABEL: Record<ScanOutcome, string> = {
  posted: "posted",
  waiting: "no setup on the chart",
  below_bar: "setup under the confidence floor",
  no_room: "too close to a trade already running (or just stopped)",
  held: "held back by its losing record",
  desk_no: "the AI desk disagreed",
  desk_late: "found too late in the minute for the AI desk",
  switched_off: "switched off on the switchboard",
  not_sent: "Telegram didn't take the post",
  check_failed: "couldn't check running trades",
  build_failed: "the chart didn't load",
};

export type ScanRun = {
  at: number;
  /** Setups looked at this run. */
  checked: number;
  posted: number;
  /** How many setups ended each way. */
  counts: Partial<Record<ScanOutcome, number>>;
  /** The most confident setup that didn't go out, if any. */
  best?: {
    market: string;
    frame: string;
    confidence: number;
    outcome: ScanOutcome;
    detail?: string;
  };
  /** Why the scan stopped before looking (posting off, channel not set up...). */
  skipped?: string;
};

export type ScanLog = { v: 1; runs: ScanRun[]; lastPostAt?: number };

export const KEEP_RUNS = 60;

/** One run's notes summed up. Pure. */
export function summariseRun(at: number, notes: ScanNote[], skipped?: string): ScanRun {
  const counts: Partial<Record<ScanOutcome, number>> = {};
  let best: ScanRun["best"];
  for (const n of notes) {
    counts[n.outcome] = (counts[n.outcome] ?? 0) + 1;
    if (n.outcome !== "posted" && n.confidence != null && (!best || n.confidence > best.confidence))
      best = {
        market: n.market,
        frame: n.frame,
        confidence: n.confidence,
        outcome: n.outcome,
        ...(n.detail ? { detail: n.detail } : {}),
      };
  }
  return {
    at,
    checked: notes.filter((n) => n.outcome !== "posted").length + (counts.posted ?? 0),
    posted: counts.posted ?? 0,
    counts,
    ...(best ? { best } : {}),
    ...(skipped ? { skipped } : {}),
  };
}

/** Add a run, keep the newest KEEP_RUNS, remember when something last posted. Pure. */
export function addRun(log: ScanLog, run: ScanRun): ScanLog {
  return {
    v: 1,
    runs: [...log.runs, run].slice(-KEEP_RUNS),
    lastPostAt: run.posted ? run.at : log.lastPostAt,
  };
}

/** A stored log, repaired. Pure. */
export function cleanScanLog(raw: unknown): ScanLog {
  const src = (raw ?? {}) as Partial<ScanLog>;
  const runs = Array.isArray(src.runs)
    ? src.runs.filter((r) => r && Number.isFinite((r as ScanRun).at)).slice(-KEEP_RUNS)
    : [];
  return {
    v: 1,
    runs: runs as ScanRun[],
    ...(Number.isFinite(src.lastPostAt) ? { lastPostAt: Number(src.lastPostAt) } : {}),
  };
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)} days ago`;
};

/**
 * The switchboard's status lines: when the last signal went out, what the last
 * scan saw, and the main reason nothing's going out over the last hour. Pure.
 */
export function scanStatus(log: ScanLog, now: number): string[] {
  const lines: string[] = [];
  lines.push(
    log.lastPostAt
      ? `Last signal: ${ago(now - log.lastPostAt)}`
      : "Last signal: none since the log started",
  );
  const last = log.runs.at(-1);
  if (!last) return [...lines, "No scan logged yet (the scan runs every minute)."];
  if (now - last.at > 5 * 60_000)
    lines.push(`⚠️ Last scan ${ago(now - last.at)}: the minute scan may have stopped running.`);
  if (last.skipped) lines.push(`Last scan ${ago(now - last.at)}: skipped (${last.skipped}).`);
  else {
    const best = last.best
      ? ` Best: ${last.best.market} ${last.best.frame} at ${last.best.confidence}% (${OUTCOME_LABEL[last.best.outcome]}).`
      : "";
    lines.push(
      `Last scan ${ago(now - last.at)}: ${last.checked} setups looked at, ${last.posted} posted.${best}`,
    );
  }
  // The last hour's main reason, when nothing posted.
  const hour = log.runs.filter((r) => now - r.at <= 60 * 60_000);
  if (hour.length && !hour.some((r) => r.posted)) {
    const tally: Partial<Record<ScanOutcome, number>> = {};
    for (const r of hour)
      for (const [k, v] of Object.entries(r.counts))
        tally[k as ScanOutcome] = (tally[k as ScanOutcome] ?? 0) + (v ?? 0);
    const skips = hour.filter((r) => r.skipped).length;
    const top = (Object.entries(tally) as [ScanOutcome, number][]).sort((a, b) => b[1] - a[1])[0];
    if (skips === hour.length)
      lines.push(`Last hour: every scan skipped (${hour.at(-1)!.skipped}).`);
    else if (top) lines.push(`Last hour, mostly: ${OUTCOME_LABEL[top[0]]} (${top[1]}).`);
  }
  return lines;
}
