/**
 * Runs `job` several times inside one cron call (pg_cron fires at most once a
 * minute): straight away, then every `everyMs`, starting no new run after
 * `lastStartMs` so the call finishes well inside the cron's 50s timeout and
 * before the next minute's call. Returns each run's result; a failed run is
 * logged and skipped.
 */
export async function repeatWithin<T>(
  job: (pass: number) => Promise<T>,
  opts: { everyMs: number; lastStartMs: number },
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<T[]> {
  const start = clock.now();
  const results: T[] = [];
  for (let pass = 0; ; pass++) {
    const due = start + pass * opts.everyMs;
    if (due - start > opts.lastStartMs) break;
    const wait = due - clock.now();
    if (wait > 0) await clock.sleep(wait);
    // A slow run can push the next one past the cut-off: skip it then.
    if (clock.now() - start > opts.lastStartMs) break;
    try {
      results.push(await job(pass));
    } catch (e) {
      console.warn(`[cron] pass ${pass} failed`, (e as Error).message);
    }
  }
  return results;
}
