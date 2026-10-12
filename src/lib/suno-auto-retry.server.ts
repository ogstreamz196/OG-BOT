import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { backfillFullAudio, extractClips, fetchTask, materialiseClips } from "./suno-recover.server";

const BACKOFF_MINUTES = [1, 3, 10, 30, 60];
const GENERATE_URL = "https://apibox.erweima.ai/api/v1/generate";
const UPLOAD_URL = "https://apibox.erweima.ai/api/v1/generate/upload-cover";
const RECORD_URL = "https://apibox.erweima.ai/api/v1/generate/record-info";

type RetrySong = Record<string, any> & { id: string; retry_count: number };

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

function scheduledFailure(song: RetrySong, reason: string) {
  const exhausted = song.retry_count >= BACKOFF_MINUTES.length;
  return {
    status: "failed",
    failure_class: exhausted ? "terminal" : "retryable",
    next_retry_at: exhausted
      ? null
      : new Date(Date.now() + BACKOFF_MINUTES[song.retry_count] * 60_000).toISOString(),
    error_message: exhausted
      ? "Automatic recovery couldn't finish this track. Tap retry to try again."
      : `Retrying automatically: ${reason}`,
  };
}

async function recoverExistingTask(song: RetrySong, apiKey: string): Promise<boolean> {
  if (!song.suno_task_id) return false;
  const response = await fetch(`${RECORD_URL}?taskId=${encodeURIComponent(song.suno_task_id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`task check returned ${response.status}`);
  const payload = await response.json();
  const clips = extractClips(payload);
  if (clips.some((clip) => !!clip.audioUrl)) {
    const result = await materialiseClips(supabaseAdmin as any, song, clips);
    if (result.parentCompleted || result.completed > 0 || result.skipped > 0) {
      await (supabaseAdmin as any)
        .from("songs")
        .update({ failure_class: null, next_retry_at: null, error_message: null })
        .eq("id", song.id);
      return true;
    }
    throw new Error("the finished audio file is not available yet");
  }

  const status = String(payload?.data?.status ?? payload?.status ?? "").toUpperCase();
  if (["PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS", "PROCESSING", "QUEUED"].includes(status)) {
    const delay = BACKOFF_MINUTES[Math.min(song.retry_count, BACKOFF_MINUTES.length - 1)];
    await (supabaseAdmin as any)
      .from("songs")
      .update({
        status: "processing",
        failure_class: "retryable",
        next_retry_at: new Date(Date.now() + delay * 60_000).toISOString(),
        error_message: "Retrying automatically while the music engine finishes the track.",
      })
      .eq("id", song.id);
    return true;
  }
  return false;
}

async function resubmit(song: RetrySong, apiKey: string, serviceRole: string, backendUrl: string) {
  const saved = (song.retry_payload ?? {}) as Record<string, any>;
  let endpoint = GENERATE_URL;
  const payload: Record<string, any> = Object.keys(saved).length
    ? { ...saved }
    : {
        prompt: song.lyrics || song.prompt,
        style: song.style || undefined,
        title: song.title || "Untitled track",
        customMode: !!(song.style || song.lyrics || song.title),
        instrumental: false,
        model: "V5",
      };

  if (saved.usesUploadedBeat && song.beat_path) {
    const { data } = await supabaseAdmin.storage
      .from("beats")
      .createSignedUrl(song.beat_path, 3600);
    if (!data?.signedUrl) throw new Error("the uploaded beat could not be read");
    payload.uploadUrl = data.signedUrl;
    endpoint = UPLOAD_URL;
  }
  delete payload.usesUploadedBeat;
  payload.callBackUrl = `${backendUrl}/functions/v1/suno-callback?song_id=${song.id}&token=${await callbackToken(song.id, serviceRole)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    // The provider can return plain text during an outage.
  }
  const taskId = body?.data?.taskId ?? body?.taskId ?? body?.task_id ?? null;
  if (!response.ok || !taskId) throw new Error(`music engine returned ${response.status}`);

  await (supabaseAdmin as any)
    .from("songs")
    .update({
      status: "processing",
      suno_task_id: taskId,
      generation_started_at: new Date().toISOString(),
      failure_class: "retryable",
      next_retry_at: new Date(Date.now() + 8 * 60_000).toISOString(),
      error_message: null,
    })
    .eq("id", song.id);
}

export async function retryDueSongs(retryToken = "") {
  const apiKey = process.env["SUNO_API_KEY"];
  const serviceRole = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const backendUrl = process.env["SUPABASE_URL"];
  if (!apiKey || !serviceRole || !backendUrl) throw new Error("Music recovery is not configured");

  const orch = await import("./song-orchestrator.server");
  await orch.queueStuckSongs().catch((e) => console.error("stuck sweep failed", e));
  const resumed = retryToken
    ? await orch.resumeOrphanedSongs(retryToken).catch((e) => (console.error("resume failed", e), 0))
    : 0;
  const alerts = await orch.alertKeyFailures().catch((e) => (console.error("key alert failed", e), 0));
  const { data, error } = await (supabaseAdmin as any).rpc("claim_due_song_retries", {
    p_limit: 3,
  });
  if (error) throw new Error(error.message);
  const results: Array<{ id: string; outcome: string }> = [];
  for (const song of (data ?? []) as RetrySong[]) {
    try {
      if (await recoverExistingTask(song, apiKey)) {
        results.push({ id: song.id, outcome: "recovered_or_waiting" });
        continue;
      }
      await resubmit(song, apiKey, serviceRole, backendUrl);
      results.push({ id: song.id, outcome: "resubmitted" });
    } catch (error) {
      await (supabaseAdmin as any)
        .from("songs")
        .update(scheduledFailure(song, (error as Error).message))
        .eq("id", song.id);
      results.push({ id: song.id, outcome: "rescheduled" });
    }
  }
  const backfilled = await backfillMissingFullTracks();
  return { processed: results.length, backfilled, resumed, alerts };
}

/**
 * Finished songs whose full-length file never landed only have the 1-minute
 * sample. Fetch the full file again from the same music-engine task.
 */
async function backfillMissingFullTracks(): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  const { data } = await (supabaseAdmin as any)
    .from("songs")
    .select("*")
    .eq("status", "completed")
    .is("audio_path", null)
    .not("sample_path", "is", null)
    .not("suno_task_id", "is", null)
    .gte("completed_at", since)
    .lte("completed_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .order("completed_at", { ascending: false })
    .limit(3);
  let fixed = 0;
  for (const song of (data ?? []) as Array<Record<string, any>>) {
    try {
      const info = await fetchTask(String(song.suno_task_id));
      if (info.ok && (await backfillFullAudio(supabaseAdmin as any, song, info.clips))) fixed++;
    } catch (e) {
      console.error("Full-track backfill failed", song.id, (e as Error).message);
    }
  }
  return fixed;
}
