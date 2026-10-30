// A daily cap on the AI desk's automatic runs (the 10-minute scouts and the
// checks on chart-engine alerts), so more trades can never run the free AI
// keys dry. One run is the whole desk: four analysts and the chief. Member
// requests aren't counted or capped. Past the cap, the engine's 70%+ alerts
// still go out on the chart alone (tagged "no_ai") and the scouts rest until
// the next UK day. Kept in site_content "signals.deskRuns".

type Admin = any;

const KEY = "signals.deskRuns";
/** Automatic desk runs a UK day (about five AI calls each, spread over the free providers). */
export const DESK_RUNS_PER_DAY = 150;

const ukDay = (now: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(now));

/** How many automatic desk runs today has had (pure read of the stored value). */
export function runsToday(value: string | null | undefined, now: number): number {
  try {
    const v = JSON.parse(value ?? "null") as { day?: string; n?: number } | null;
    return v?.day === ukDay(now) ? Number(v.n) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Takes one automatic desk run from today's budget: true if there was one
 * left. On any trouble reading it, false (the AI is spared, never overspent).
 */
export async function takeDeskRun(admin: Admin, now = Date.now()): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("site_content")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error) return false;
    const n = runsToday((data as { value?: string } | null)?.value, now);
    if (n >= DESK_RUNS_PER_DAY) return false;
    const at = new Date(now).toISOString();
    await admin
      .from("site_content")
      .upsert(
        { key: KEY, value: JSON.stringify({ day: ukDay(now), n: n + 1 }), updated_at: at },
        { onConflict: "key" },
      );
    return true;
  } catch {
    return false;
  }
}

/** Today's count, for the scan's response. */
export async function deskRunsToday(admin: Admin, now = Date.now()): Promise<number> {
  try {
    const { data } = await admin.from("site_content").select("value").eq("key", KEY).maybeSingle();
    return runsToday((data as { value?: string } | null)?.value, now);
  } catch {
    return 0;
  }
}
