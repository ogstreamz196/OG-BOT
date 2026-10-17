// Nasheed mode: after the music engine finishes, keep only Take 1, ask the
// engine to separate its vocals from the mix, and deliver the acapella alone.
// Mirrored for the app's recovery code in src/lib/nasheed-stems.server.ts.

export const VOCAL_REMOVAL_URL = "https://apibox.erweima.ai/api/v1/vocal-removal/generate";
export const VOCAL_REMOVAL_RECORD_URL = "https://apibox.erweima.ai/api/v1/vocal-removal/record-info";

type Clip = {
  audioUrl?: string | null;
  clipId?: string | null;
  coverUrl?: string | null;
  title?: string | null;
  duration?: number | null;
};

/** A Nasheed is only separated once it has been paid for at the Nasheed price. */
export async function isPaidNasheed(admin: any, song: Record<string, any>): Promise<boolean> {
  if (!song?.is_nasheed) return false;
  if (song.unlocked) return true;
  const { data } = await admin
    .from("unlocked_songs")
    .select("id")
    .eq("user_id", song.user_id)
    .eq("song_id", song.id)
    .maybeSingle();
  return !!data;
}

/** The pure-vocal file from any shape of vocal-removal callback or record. */
export function extractVocalUrl(payload: any): string | null {
  const spots = [
    payload?.data?.vocal_removal_info,
    payload?.data?.vocalRemovalInfo,
    payload?.data?.response,
    payload?.data,
    payload?.response,
    payload,
  ];
  for (const s of spots) {
    const url = s?.vocal_url ?? s?.vocalUrl ?? s?.vocal_audio_url ?? s?.vocalAudioUrl;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  return null;
}

/** True when a vocal-removal callback reports failure. */
export function vocalRemovalFailed(payload: any): boolean {
  const code = payload?.code ?? payload?.data?.code;
  const flag = String(payload?.data?.successFlag ?? payload?.data?.status ?? "").toUpperCase();
  return (typeof code === "number" && code !== 200) || /FAIL|ERROR/.test(flag);
}

/**
 * Starts vocal separation on Take 1 (the first usable clip). Take 2 is never
 * saved. Safe to call again: a job already running for the same take is left
 * alone. Returns true when separation is (now) under way.
 */
export async function requestVocalSeparation(
  admin: any,
  song: Record<string, any>,
  clips: Clip[],
  opts: { apiKey: string; callbackUrl: string; taskId?: string | null },
): Promise<boolean> {
  const take1 = clips.find((c) => !!c.audioUrl);
  if (!take1?.audioUrl) return false;
  if (song.stem_task_id && song.stem_source_clip_id && song.stem_source_clip_id === take1.clipId) {
    return true;
  }
  const res = await fetch(VOCAL_REMOVAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      taskId: opts.taskId ?? song.suno_task_id,
      audioId: take1.clipId,
      audio_url: take1.audioUrl,
      type: "separate_vocal",
      callBackUrl: opts.callbackUrl,
      call_back_url: opts.callbackUrl,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* plain-text error */
  }
  const stemTask = body?.data?.taskId ?? body?.data?.task_id ?? body?.taskId ?? body?.task_id ?? null;
  const code = typeof body?.code === "number" ? body.code : res.status;
  if (!res.ok || code !== 200 || !stemTask) {
    console.error("Vocal separation request failed", song.id, code, text.slice(0, 300));
    await admin
      .from("songs")
      .update({
        status: "failed",
        failure_class: "retryable",
        next_retry_at: new Date(Date.now() + 2 * 60_000).toISOString(),
        error_message: "Separating the vocals. Retrying automatically in a moment.",
        stem_task_id: null,
      })
      .eq("id", song.id);
    return false;
  }
  await admin
    .from("songs")
    .update({
      status: "processing",
      stem_task_id: String(stemTask),
      stem_source_clip_id: take1.clipId ?? null,
      // Take 1's artwork, title and length carry over to the vocal file.
      cover_url: take1.coverUrl ?? song.cover_url ?? null,
      title: song.title ?? take1.title ?? null,
      duration_seconds: take1.duration ?? song.duration_seconds ?? null,
      // The live preview would play the full mix; a Nasheed only ever plays vocals.
      stream_audio_url: null,
      error_message: null,
      // Safety net: the retry sweep checks on the separation if its callback is lost.
      failure_class: "retryable",
      next_retry_at: new Date(Date.now() + 6 * 60_000).toISOString(),
    })
    .eq("id", song.id);
  return true;
}
