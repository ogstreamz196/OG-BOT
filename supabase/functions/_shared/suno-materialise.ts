// Shared Suno clip → song-row materialisation.
//
// Used by both the Suno completion webhook (suno-callback) and the on-demand
// reconciliation endpoint (suno-reconcile) so a track can always be recovered
// later with exactly the same logic that would have run at callback time.
//
// Resilience rules that matter:
//   * Every network read is wrapped in an abort timeout. Suno's temporary file
//     CDN sometimes accepts the connection, sends headers, then stalls forever
//     on the body. Without a timeout that hangs the whole function.
//   * Each clip is attempted independently. Suno returns 1-2 takes per task; if
//     take 1's file is broken on their CDN we fall through to take 2 instead of
//     leaving the song stuck in "processing".
//   * The parent song row is filled by the FIRST clip that downloads cleanly,
//     not blindly by clip index 0.

// ~1 MB sample — covers >30s of mp3 audio at typical Suno bitrates.
export const SAMPLE_BYTES = 1_048_576;

/** Abort a stalled download rather than hanging the whole invocation. */
const SAMPLE_TIMEOUT_MS = 25_000;
const FULL_TIMEOUT_MS = 180_000;
const FULL_ATTEMPTS = 3;
/** Synchronous full-master download window (per attempt) before falling back. */
const SYNC_FULL_TIMEOUT_MS = 60_000;

// Allow-list of hostnames we'll fetch audio from (defence-in-depth SSRF guard).
export const AUDIO_HOST_ALLOWLIST = [
  "apibox.erweima.ai",
  "cdn1.suno.ai",
  "cdn2.suno.ai",
  "audiopipe.suno.ai",
  "mfile.erweima.ai",
  "sunoapi.org",
  "tempfile.aiquickdraw.com",
  "aiquickdraw.com",
  "musicfile.removeai.ai",
  "removeai.ai",
  // Live stream host used by the early "first"/"text" callback.
  "audiostream.api.box",
  "api.box",
];

export function hostAllowed(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return AUDIO_HOST_ALLOWLIST.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Owner-tagged storage metadata so every object can be traced back to its user. */
export function ownerMeta(userId: string, songId: string, kind: "sample" | "full") {
  return { user_id: userId, song_id: songId, kind, uploaded_at: new Date().toISOString() };
}

export type SunoClip = {
  audioUrl?: string | null;
  streamUrl?: string | null;
  coverUrl?: string | null;
  title?: string | null;
  duration?: number | null;
  clipId?: string | null;
};

/** Normalise the many shapes Suno uses for a clip into one struct. */
export function normaliseClip(c: any): SunoClip {
  return {
    audioUrl: c?.audio_url || c?.audioUrl || c?.source_audio_url,
    streamUrl:
      c?.stream_audio_url || c?.streamAudioUrl || c?.streamAudioURL || c?.source_stream_audio_url,
    coverUrl: c?.image_url || c?.imageUrl || c?.cover_url,
    title: c?.title,
    duration: c?.duration,
    clipId: c?.id || c?.clip_id,
  };
}

/** Pull the clip array out of any Suno payload/record-info envelope. */
export function extractClips(payload: any): SunoClip[] {
  const rawItems =
    payload?.data?.response?.sunoData ||
    payload?.response?.sunoData ||
    payload?.sunoData ||
    payload?.data?.data ||
    payload?.data ||
    (Array.isArray(payload) ? payload : null) ||
    (payload?.clip ? [payload.clip] : null) ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items.map(normaliseClip);
}

/** Fetch with a hard abort timeout — protects against stalled CDN bodies. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Read the body here so a stall *during* streaming is also covered by the timer.
    const buf = new Uint8Array(await res.arrayBuffer());
    return { res, buf };
  } finally {
    clearTimeout(timer);
  }
}

/** How many song rows this task is allowed to produce (boss setting, default 1). */
export async function maxVariantsFor(admin: any): Promise<number> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "songs_per_generation")
      .maybeSingle();
    const v = data?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 4) return n;
  } catch {
    /* fall through to default */
  }
  return 1;
}

export type MaterialiseResult = {
  /** Number of song rows successfully completed by this run. */
  completed: number;
  /** True when the parent row itself now holds playable audio. */
  parentCompleted: boolean;
  /** Clips that were present but whose audio could not be downloaded. */
  brokenClips: string[];
  /** Clips already materialised by a previous run. */
  skipped: string[];
};

/**
 * Download each usable clip and write it into song rows.
 *
 * The first clip that downloads cleanly fills `songId`; any further clips
 * (within the boss's per-generation limit) become sibling variation rows.
 * Clips whose audio is broken on Suno's CDN are skipped, never fatal.
 */
export async function materialiseClips(
  admin: any,
  parentSong: Record<string, any>,
  allClips: SunoClip[],
  opts: { scheduleBackground?: (task: Promise<unknown>) => void } = {},
): Promise<MaterialiseResult> {
  const songId = String(parentSong.id);
  const userId = String(parentSong.user_id);
  const result: MaterialiseResult = {
    completed: 0,
    parentCompleted: false,
    brokenClips: [],
    skipped: [],
  };

  const usable = allClips.filter((c) => !!c.audioUrl && hostAllowed(c.audioUrl!));
  if (usable.length === 0) return result;

  // Always keep at least 2 takes: the visible one plus a hidden alt-take the
  // user can unlock later as a discounted "remake".
  const maxVariants = Math.max(2, await maxVariantsFor(admin));

  // Has the parent row already been filled (by an earlier callback/reconcile)?
  let parentTaken = !!parentSong.sample_path || !!parentSong.audio_path;

  for (const clip of usable) {
    if (result.completed >= maxVariants) break;

    // Idempotency: a row already exists for this Suno clip.
    if (clip.clipId) {
      const { data: existing } = await admin
        .from("songs")
        .select("id")
        .eq("suno_clip_id", clip.clipId)
        .maybeSingle();
      if (existing) {
        result.skipped.push(clip.clipId);
        if (existing.id === songId) parentTaken = true;
        continue;
      }
    }

    // --- Phase 1: the FULL master file, downloaded and saved before anything
    // else. The 1-minute sample is just the first slice of that same file, so
    // a song is never marked finished with only a sample.
    let fullBuf: Uint8Array | null = null;
    for (let attempt = 1; attempt <= 2 && !fullBuf; attempt++) {
      try {
        const { res, buf } = await fetchWithTimeout(clip.audioUrl!, {}, SYNC_FULL_TIMEOUT_MS);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (buf.byteLength === 0) throw new Error("empty body");
        fullBuf = buf;
      } catch (e) {
        console.error("Full download attempt failed", clip.clipId, attempt, (e as Error).message);
      }
    }

    let sampleBuf: Uint8Array;
    if (fullBuf) {
      sampleBuf = fullBuf.byteLength > SAMPLE_BYTES ? fullBuf.slice(0, SAMPLE_BYTES) : fullBuf;
    } else {
      // Last resort: CDN won't serve the whole file right now. Grab a sample so
      // the clip is usable; the background loop + scheduled sweep fetch the full.
      try {
        const { res, buf } = await fetchWithTimeout(
          clip.audioUrl!,
          { headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` } },
          SAMPLE_TIMEOUT_MS,
        );
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        if (buf.byteLength === 0) throw new Error("empty body");
        sampleBuf = buf;
      } catch (e) {
        console.error("Clip unusable, trying next take:", clip.clipId, (e as Error).message);
        result.brokenClips.push(clip.clipId ?? clip.audioUrl!);
        continue;
      }
    }

    // Decide which row this clip fills.
    let targetId: string;
    if (!parentTaken) {
      targetId = songId;
      parentTaken = true;
    } else {
      const { data: sib, error: sibErr } = await admin
        .from("songs")
        .insert({
          user_id: userId,
          prompt: parentSong.prompt,
          style: parentSong.style,
          lyrics: parentSong.lyrics,
          title: clip.title ?? parentSong.title,
          status: "processing",
          suno_task_id: parentSong.suno_task_id,
          suno_clip_id: clip.clipId ?? null,
          portal_id: parentSong.portal_id ?? null,
          is_variation: true,
          revealed: false,
          foul_mouth: parentSong.foul_mouth ?? false,
          foul_intensity: parentSong.foul_intensity ?? 0,
        })
        .select("id")
        .single();
      if (sibErr) {
        // Unique-index race: another concurrent run already inserted this clip.
        if ((sibErr as { code?: string }).code === "23505") {
          result.skipped.push(clip.clipId ?? "");
          continue;
        }
        console.error("Sibling insert failed", sibErr);
        continue;
      }
      targetId = sib.id;
    }

    const samplePath = `${userId}/${targetId}.sample.mp3`;
    const { error: sampleUpErr } = await admin.storage
      .from("song-files")
      .upload(samplePath, sampleBuf, {
        contentType: "audio/mpeg",
        upsert: true,
        metadata: ownerMeta(userId, targetId, "sample"),
      } as any);
    if (sampleUpErr) {
      console.error("Sample upload failed for", targetId, sampleUpErr);
      if (targetId === songId) parentTaken = false;
      result.brokenClips.push(clip.clipId ?? clip.audioUrl!);
      continue;
    }

    // Save the full master alongside the sample before marking completed.
    let savedFullPath: string | null = null;
    if (fullBuf && fullBuf.byteLength > 0) {
      const fullPath = `${userId}/${targetId}.mp3`;
      const { error: fullUpErr } = await admin.storage.from("song-files").upload(fullPath, fullBuf, {
        contentType: "audio/mpeg",
        upsert: true,
        metadata: ownerMeta(userId, targetId, "full"),
      } as any);
      if (fullUpErr) console.error("Full upload failed for", targetId, fullUpErr);
      else savedFullPath = fullPath;
    }

    await admin
      .from("songs")
      .update({
        status: "completed",
        sample_path: samplePath,
        ...(savedFullPath ? { audio_path: savedFullPath } : {}),
        cover_url: clip.coverUrl ?? null,
        title: clip.title ?? parentSong.title,
        suno_clip_id: clip.clipId ?? null,
        duration_seconds: clip.duration ?? null,
        stream_audio_url: clip.streamUrl ?? parentSong.stream_audio_url ?? null,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", targetId);

    result.completed += 1;
    if (targetId === songId) result.parentCompleted = true;
    if (savedFullPath) continue;

    // --- Phase 2 (fallback only): full download retried in the background ---
    const finalId = targetId;
    const audioUrl = clip.audioUrl!;
    const bgTask = (async () => {
      // Several attempts: a single stalled CDN read used to leave the song
      // with only its 1-minute sample. The scheduled sweep retries later too.
      for (let attempt = 1; attempt <= FULL_ATTEMPTS; attempt++) {
        try {
          const { res, buf } = await fetchWithTimeout(audioUrl, {}, FULL_TIMEOUT_MS);
          if (!res.ok) throw new Error(`Full download failed: ${res.status}`);
          if (buf.byteLength <= SAMPLE_BYTES) throw new Error("Full download looked truncated");
          const fullPath = `${userId}/${finalId}.mp3`;
          const { error: fullUpErr } = await admin.storage
            .from("song-files")
            .upload(fullPath, buf, {
              contentType: "audio/mpeg",
              upsert: true,
              metadata: ownerMeta(userId, finalId, "full"),
            } as any);
          if (fullUpErr) throw fullUpErr;
          await admin.from("songs").update({ audio_path: fullPath }).eq("id", finalId);
          console.log("Full track stored for", finalId, "attempt", attempt);
          return;
        } catch (e) {
          console.error("Full-download attempt failed", finalId, attempt, (e as Error).message);
          if (attempt < FULL_ATTEMPTS) await new Promise((r) => setTimeout(r, 5_000 * attempt));
        }
      }
    })();

    if (opts.scheduleBackground) opts.scheduleBackground(bgTask);
    else await bgTask.catch(() => {});
  }

  return result;
}

/**
 * Best-effort recovery of the full-length file for a song that already has a
 * playable sample but whose background download never landed.
 */
export async function backfillFullAudio(
  admin: any,
  song: Record<string, any>,
  clips: SunoClip[],
): Promise<boolean> {
  if (song.audio_path) return false;
  const clip = clips.find((c) => c.clipId && c.clipId === song.suno_clip_id) ?? clips[0];
  if (!clip?.audioUrl || !hostAllowed(clip.audioUrl)) return false;
  try {
    const { res, buf } = await fetchWithTimeout(clip.audioUrl, {}, FULL_TIMEOUT_MS);
    if (!res.ok || buf.byteLength === 0) return false;
    const fullPath = `${song.user_id}/${song.id}.mp3`;
    const { error } = await admin.storage.from("song-files").upload(fullPath, buf, {
      contentType: "audio/mpeg",
      upsert: true,
      metadata: ownerMeta(String(song.user_id), String(song.id), "full"),
    } as any);
    if (error) return false;
    await admin.from("songs").update({ audio_path: fullPath }).eq("id", song.id);
    return true;
  } catch (e) {
    console.error("Full-audio backfill failed for", song.id, (e as Error).message);
    return false;
  }
}
