// Saves each scan run's summary (signal-scan-log.ts) in site_content
// "signals.scanlog". Never throws; a failed save just skips that run's line.

import { addRun, cleanScanLog, summariseRun, type ScanLog, type ScanNote } from "./signal-scan-log";

type Admin = { from: (t: string) => any };
export const SCANLOG_KEY = "signals.scanlog";

export async function loadScanLog(admin: Admin): Promise<ScanLog> {
  try {
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", SCANLOG_KEY)
      .maybeSingle();
    return cleanScanLog(JSON.parse((data as { value?: string } | null)?.value ?? "{}"));
  } catch {
    return cleanScanLog({});
  }
}

export async function saveScanRun(
  admin: Admin,
  notes: ScanNote[],
  skipped?: string,
  now = Date.now(),
): Promise<void> {
  try {
    const log = addRun(await loadScanLog(admin), summariseRun(now, notes, skipped));
    await admin
      .from("site_content")
      .upsert(
        { key: SCANLOG_KEY, value: JSON.stringify(log), updated_at: new Date(now).toISOString() },
        { onConflict: "key" },
      );
  } catch (e) {
    console.warn("[scanlog]", e);
  }
}
