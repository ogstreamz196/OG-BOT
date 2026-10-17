// Nasheed recovery for the app server (auto-retry sweep, recover button,
// full-file backfill). The separation logic itself is shared with the edge
// functions so both sides behave identically.
import {
  VOCAL_REMOVAL_RECORD_URL,
  extractVocalUrl,
  isPaidNasheed,
  requestVocalSeparation,
  vocalRemovalFailed,
} from "../../supabase/functions/_shared/nasheed-stems";

export { extractVocalUrl, isPaidNasheed };

type Clip = {
  audioUrl?: string | null;
  clipId?: string | null;
  coverUrl?: string | null;
  title?: string | null;
  duration?: number | null;
};

async function callbackToken(songId: string, serviceRole: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(serviceRole),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(songId));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function env() {
  const apiKey = process.env["SUNO_API_KEY"];
  const serviceRole = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const backendUrl = process.env["SUPABASE_URL"];
  return apiKey && serviceRole && backendUrl ? { apiKey, serviceRole, backendUrl } : null;
}

export type StemCheck =
  | { state: "ready"; vocalUrl: string }
  | { state: "pending" }
  | { state: "failed" }
  | { state: "none" };

/** Asks the engine how a Nasheed's vocal separation is going. */
export async function checkVocalSeparation(song: Record<string, any>): Promise<StemCheck> {
  const cfg = env();
  if (!cfg || !song.stem_task_id) return { state: "none" };
  const res = await fetch(
    `${VOCAL_REMOVAL_RECORD_URL}?taskId=${encodeURIComponent(String(song.stem_task_id))}`,
    { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) return { state: "pending" };
  const payload = await res.json().catch(() => ({}));
  const vocalUrl = extractVocalUrl(payload);
  if (vocalUrl) return { state: "ready", vocalUrl };
  return vocalRemovalFailed(payload) ? { state: "failed" } : { state: "pending" };
}

/** Starts (or re-starts) vocal separation on Take 1 from the app server. */
export async function startVocalSeparation(
  admin: any,
  song: Record<string, any>,
  clips: Clip[],
): Promise<boolean> {
  const cfg = env();
  if (!cfg) return false;
  const token = await callbackToken(String(song.id), cfg.serviceRole);
  return requestVocalSeparation(admin, song, clips, {
    apiKey: cfg.apiKey,
    callbackUrl: `${cfg.backendUrl}/functions/v1/suno-callback?song_id=${song.id}&token=${token}&stage=stems`,
  });
}

/** Marks a Nasheed as still separating, so the retry sweep looks again later. */
export async function markSeparating(admin: any, songId: string) {
  await admin
    .from("songs")
    .update({
      status: "processing",
      failure_class: "retryable",
      next_retry_at: new Date(Date.now() + 3 * 60_000).toISOString(),
      error_message: "Separating the vocals from the music. Nearly there.",
    })
    .eq("id", songId);
}
