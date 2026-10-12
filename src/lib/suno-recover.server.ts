// Server-only recovery helpers for tracks that got stuck during generation.
//
// Background: the music engine returns 1-2 takes per job. Occasionally its
// temporary file server accepts the connection, sends headers, then stalls on
// the body forever. When that happened during the completion webhook the whole
// job died and the track stayed "processing" with no audio, even though a
// perfectly good second take existed.
//
// These helpers ask the engine what actually happened and rebuild the track
// from whichever take downloads cleanly. No coins are ever spent here.

type AnyClient = {
  from: (t: string) => any;
  storage: { from: (b: string) => any };
};

const RECORD_INFO_URL = "https://apibox.erweima.ai/api/v1/generate/record-info";
const SAMPLE_BYTES = 1_048_576;
const SAMPLE_TIMEOUT_MS = 25_000;
const FULL_TIMEOUT_MS = 180_000;

const AUDIO_HOST_ALLOWLIST = [
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

export type SunoClip = {
  audioUrl?: string | null;
  streamUrl?: string | null;
  coverUrl?: string | null;
  title?: string | null;
  duration?: number | null;
  clipId?: string | null;
};

function normaliseClip(c: any): SunoClip {
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

export function extractClips(payload: any): SunoClip[] {
  const raw =
    payload?.data?.response?.sunoData ||
    payload?.response?.sunoData ||
    payload?.sunoData ||
    payload?.data?.data ||
    (Array.isArray(payload?.data) ? payload.data : null) ||
    (Array.isArray(payload) ? payload : null) ||
    [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map(normaliseClip).filter((c) => !!c.audioUrl || !!c.streamUrl);
}

async function fetchBytes(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { res, buf };
  } finally {
    clearTimeout(timer);
  }
}

export type TaskInfo =
  | { ok: true; status: string | null; clips: SunoClip[] }
  | { ok: false; detail: string };

export async function fetchTask(taskId: string): Promise<TaskInfo> {
  const key = process.env["SUNO_API_KEY"];
  if (!key) return { ok: false, detail: "missing_api_key" };
  try {
    const res = await fetch(`${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const json = JSON.parse(text);
    const status = json?.data?.status ?? json?.status ?? null;
    return { ok: true, status: status ? String(status) : null, clips: extractClips(json) };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

async function maxVariantsFor(admin: AnyClient): Promise<number> {
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
    /* default below */
  }
  return 1;
}

export type MaterialiseResult = {
  completed: number;
  parentCompleted: boolean;
  broken: number;
  skipped: number;
};

/**
 * Rebuild song rows from the engine's takes. The first take that downloads
 * cleanly fills the original track; extra takes (within the per-generation
 * limit) become sibling variations. Broken takes are skipped, never fatal.
 */
export async function materialiseClips(
  admin: AnyClient,
  parentSong: Record<string, any>,
  allClips: SunoClip[],
): Promise<MaterialiseResult> {
  const songId = String(parentSong.id);
  const userId = String(parentSong.user_id);
  const out: MaterialiseResult = { completed: 0, parentCompleted: false, broken: 0, skipped: 0 };

  const usable = allClips.filter((c) => !!c.audioUrl && hostAllowed(c.audioUrl!));
  if (usable.length === 0) return out;

  // Keep at least 2 takes so the hidden alt-take stays available to unlock.
  const maxVariants = Math.max(2, await maxVariantsFor(admin));
  let parentTaken = !!parentSong.sample_path || !!parentSong.audio_path;

  for (const clip of usable) {
    if (out.completed >= maxVariants) break;

    if (clip.clipId) {
      const { data: existing } = await admin
        .from("songs")
        .select("id")
        .eq("suno_clip_id", clip.clipId)
        .maybeSingle();
      if (existing) {
        out.skipped += 1;
        if (existing.id === songId) parentTaken = true;
        continue;
      }
    }

    let sampleBuf: Uint8Array;
    try {
      const { res, buf } = await fetchBytes(
        clip.audioUrl!,
        { headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` } },
        SAMPLE_TIMEOUT_MS,
      );
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      if (buf.byteLength === 0) throw new Error("empty body");
      sampleBuf = buf;
    } catch (e) {
      console.error(
        "[suno-recover] take unreadable, trying next:",
        clip.clipId,
        (e as Error).message,
      );
      out.broken += 1;
      continue;
    }

    let targetId = songId;
    if (parentTaken) {
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
        })
        .select("id")
        .single();
      if (sibErr || !sib) {
        if ((sibErr as { code?: string } | null)?.code === "23505") out.skipped += 1;
        else console.error("[suno-recover] sibling insert failed", sibErr);
        continue;
      }
      targetId = sib.id;
    } else {
      parentTaken = true;
    }

    const samplePath = `${userId}/${targetId}.sample.mp3`;
    const { error: upErr } = await admin.storage.from("song-files").upload(samplePath, sampleBuf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      console.error("[suno-recover] sample upload failed", upErr);
      if (targetId === songId) parentTaken = false;
      out.broken += 1;
      continue;
    }

    await admin
      .from("songs")
      .update({
        status: "completed",
        sample_path: samplePath,
        cover_url: clip.coverUrl ?? parentSong.cover_url ?? null,
        title: clip.title ?? parentSong.title,
        suno_clip_id: clip.clipId ?? null,
        duration_seconds: clip.duration ?? null,
        stream_audio_url: clip.streamUrl ?? parentSong.stream_audio_url ?? null,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", targetId);

    out.completed += 1;
    if (targetId === songId) out.parentCompleted = true;

    // Full-length file — best effort, the sample already plays.
    try {
      const { res, buf } = await fetchBytes(clip.audioUrl!, {}, FULL_TIMEOUT_MS);
      if (res.ok && buf.byteLength > 0) {
        const fullPath = `${userId}/${targetId}.mp3`;
        const { error: fullErr } = await admin.storage
          .from("song-files")
          .upload(fullPath, buf, { contentType: "audio/mpeg", upsert: true });
        if (!fullErr) await admin.from("songs").update({ audio_path: fullPath }).eq("id", targetId);
      }
    } catch (e) {
      console.error("[suno-recover] full download failed", targetId, (e as Error).message);
    }
  }

  return out;
}

/** Fetch the full-length file for a track that already has a playable sample. */
export async function backfillFullAudio(
  admin: AnyClient,
  song: Record<string, any>,
  clips: SunoClip[],
): Promise<boolean> {
  if (song.audio_path) return false;
  const clip = clips.find((c) => c.clipId && c.clipId === song.suno_clip_id) ?? clips[0];
  if (!clip?.audioUrl || !hostAllowed(clip.audioUrl)) return false;
  try {
    const { res, buf } = await fetchBytes(clip.audioUrl, {}, FULL_TIMEOUT_MS);
    if (!res.ok || buf.byteLength === 0) return false;
    const fullPath = `${song.user_id}/${song.id}.mp3`;
    const { error } = await admin.storage
      .from("song-files")
      .upload(fullPath, buf, { contentType: "audio/mpeg", upsert: true });
    if (error) return false;
    await admin.from("songs").update({ audio_path: fullPath }).eq("id", song.id);
    return true;
  } catch {
    return false;
  }
}
