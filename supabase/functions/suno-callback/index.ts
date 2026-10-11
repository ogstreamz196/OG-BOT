// Public webhook for Suno completion callbacks.
// Suno returns 1-2 clips per task. We fan them out into individual song rows:
// the first clip updates the original pending row, additional clips create sibling rows
// owned by the same user and tagged with the same suno_task_id.
//
// Two-phase storage:
//   1) Download a short SAMPLE_BYTES range from each clip, upload as `<user>/<song>.sample.mp3`
//      and immediately mark the song "completed" so the UI unblocks.
//   2) Schedule a background task (EdgeRuntime.waitUntil) that downloads the full file,
//      uploads it as `<user>/<song>.mp3`, and updates audio_path + duration. All uploaded
//      objects carry user_id / song_id custom metadata so files are traceable to the owner.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isModerationRejection, MODERATION_MESSAGE } from "../_shared/moderation-safe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ~1 MB sample — covers >30s of mp3 audio at typical Suno bitrates.
const SAMPLE_BYTES = 1_048_576;

// Allow-list of hostnames we'll fetch audio from (defence-in-depth SSRF guard).
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
  // Live stream host used by the early "first"/"text" callback.
  "audiostream.api.box",
  "api.box",
];

function hostAllowed(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return AUDIO_HOST_ALLOWLIST.some((d) => h === d || h.endsWith("." + d));
  } catch { return false; }
}

async function expectedToken(songId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(songId));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Owner-tagged storage metadata so every object can be traced back to its user.
function ownerMeta(userId: string, songId: string, kind: "sample" | "full") {
  return { user_id: userId, song_id: songId, kind, uploaded_at: new Date().toISOString() };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const songId = url.searchParams.get("song_id");
  const token = url.searchParams.get("token") ?? "";
  if (!songId) return new Response("Missing song_id", { status: 400 });

  const expected = await expectedToken(songId);
  if (!timingSafeEq(token, expected)) {
    console.warn("Suno callback rejected: bad token for", songId);
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* tolerate empty */ }
  console.log("Suno callback for", songId, JSON.stringify(payload).slice(0, 800));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: parentSong } = await admin.from("songs").select("*").eq("id", songId).single();
  if (!parentSong) return new Response("Song not found", { status: 404 });

  // Failure callback
  const callbackType = payload?.data?.callbackType || payload?.callbackType;
  if (callbackType === "error" || (payload?.code && payload.code !== 200)) {
    if (parentSong.status === "completed" || parentSong.status === "failed") {
      console.log("Skipping refund — song already terminal:", parentSong.status);
      return new Response("ok", { status: 200 });
    }
    const refundAmt = 0;
    const rawReason = payload?.msg || payload?.message || "Suno reported failure";
    await admin.from("songs").update({
      status: "failed",
      error_message: isModerationRejection(rawReason) ? MODERATION_MESSAGE : rawReason,
    }).eq("id", songId);
    if (refundAmt > 0) {
      await admin.from("coin_transactions").insert({
        user_id: parentSong.user_id, amount: refundAmt, type: "refund", reference: songId,
      });
      const { data: prof } = await admin.from("profiles").select("coin_balance").eq("id", parentSong.user_id).single();
      await admin.from("profiles").update({ coin_balance: (prof?.coin_balance ?? 0) + refundAmt }).eq("id", parentSong.user_id);
    }
    return new Response("ok", { status: 200 });
  }

  const rawItems =
    payload?.data?.data ||
    payload?.data ||
    (Array.isArray(payload) ? payload : null) ||
    (payload?.clip ? [payload.clip] : null) ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const clipsRaw = items.map((c: any) => ({
    audioUrl: c?.audio_url || c?.audioUrl || c?.source_audio_url,
    streamUrl: c?.stream_audio_url || c?.streamAudioUrl || c?.streamAudioURL || c?.source_stream_audio_url,
    coverUrl: c?.image_url || c?.imageUrl || c?.cover_url,
    title: c?.title,
    duration: c?.duration,
    clipId: c?.id || c?.clip_id,
  }));

  const callbackTaskId = payload?.data?.task_id || payload?.data?.taskId || payload?.task_id || payload?.taskId || null;
  if (callbackTaskId && !parentSong.suno_task_id) {
    await admin.from("songs").update({ suno_task_id: callbackTaskId }).eq("id", songId);
  }

  // Early "first"/"text" callback: Suno only has the stream URL, not the final
  // file. Persist the stream URL so the UI can offer a live Suno-style preview
  // while we wait for the "complete" callback to deliver the downloadable file.
  if (callbackType === "first" || callbackType === "text") {
    const firstStream = clipsRaw.find((c) => c.streamUrl && hostAllowed(c.streamUrl!));
    if (firstStream?.streamUrl && !parentSong.stream_audio_url) {
      await admin.from("songs").update({
        stream_audio_url: firstStream.streamUrl,
        cover_url: firstStream.coverUrl ?? parentSong.cover_url,
        title: firstStream.title ?? parentSong.title,
      }).eq("id", songId);
      console.log("Stream URL stored for live preview:", songId);
    }
    return new Response("streaming", { status: 200 });
  }

  let clips = clipsRaw.filter((c) => !!c.audioUrl && hostAllowed(c.audioUrl!));

  if (clips.length === 0) {
    console.log("No audio clips ready yet (or all rejected by host allow-list)");
    return new Response("waiting", { status: 200 });
  }

  // Respect admin "songs per generation" setting (default 1). Suno always returns
  // 2 clips per task, but we only materialise as many song rows as the boss allows.
  let maxVariants = 1;
  try {
    const { data: vs } = await admin.from("app_settings").select("value").eq("key", "songs_per_generation").maybeSingle();
    const v = vs?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 4) maxVariants = n;
  } catch { /* default to 1 */ }
  if (clips.length > maxVariants) clips = clips.slice(0, maxVariants);

  // Track which row is being processed so a failure on a sibling clip does
  // not flip the already-completed parent song to "failed".
  let currentId: string | null = null;
  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      currentId = i === 0 ? songId : null;

      // Idempotency: if we've already materialised a row for this Suno clip
      // (parent or sibling), skip — repeated callbacks must not duplicate.
      if (clip.clipId) {
        const { data: existing } = await admin
          .from("songs").select("id").eq("suno_clip_id", clip.clipId).maybeSingle();
        if (existing) {
          console.log("Skipping duplicate clip", clip.clipId, "→ existing song", existing.id);
          continue;
        }
      }

      // --- Phase 1: short sample (fast) ---
      const sampleRes = await fetch(clip.audioUrl!, { headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` } });
      if (!sampleRes.ok && sampleRes.status !== 206) {
        throw new Error(`Sample download failed: ${sampleRes.status}`);
      }
      const sampleBuf = new Uint8Array(await sampleRes.arrayBuffer());

      let targetId: string | null = i === 0 ? songId : null;
      if (!targetId) {
        const { data: sib, error: sibErr } = await admin.from("songs").insert({
          user_id: parentSong.user_id,
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
        }).select("id").single();
        if (sibErr) {
          // Unique-index race: another concurrent callback already inserted this clip.
          if ((sibErr as { code?: string }).code === "23505") {
            console.log("Sibling insert race for clip", clip.clipId, "— already exists, skipping");
            continue;
          }
          throw sibErr;
        }
        targetId = sib.id;
      }
      currentId = targetId;

      const samplePath = `${parentSong.user_id}/${targetId}.sample.mp3`;
      const { error: sampleUpErr } = await admin.storage.from("song-files").upload(samplePath, sampleBuf, {
        contentType: "audio/mpeg",
        upsert: true,
        metadata: ownerMeta(parentSong.user_id, targetId, "sample"),
      } as any);
      if (sampleUpErr) throw sampleUpErr;

      // Mark completed now — UI can play the sample immediately.
      await admin.from("songs").update({
        status: "completed",
        sample_path: samplePath,
        cover_url: clip.coverUrl ?? null,
        title: clip.title ?? parentSong.title,
        suno_clip_id: clip.clipId ?? null,
        duration_seconds: clip.duration ?? null,
        completed_at: new Date().toISOString(),
      }).eq("id", targetId);

      // --- Phase 2: full download in background ---
      const finalId = targetId;
      const audioUrl = clip.audioUrl!;
      const bgTask = (async () => {
        try {
          const fullRes = await fetch(audioUrl);
          if (!fullRes.ok) throw new Error(`Full download failed: ${fullRes.status}`);
          const fullBuf = new Uint8Array(await fullRes.arrayBuffer());
          const fullPath = `${parentSong.user_id}/${finalId}.mp3`;
          const { error: fullUpErr } = await admin.storage.from("song-files").upload(fullPath, fullBuf, {
            contentType: "audio/mpeg",
            upsert: true,
            metadata: ownerMeta(parentSong.user_id, finalId, "full"),
          } as any);
          if (fullUpErr) throw fullUpErr;
          await admin.from("songs").update({ audio_path: fullPath }).eq("id", finalId);
          console.log("Full track stored for", finalId);
        } catch (e) {
          console.error("Background full-download failed for", finalId, e);
        }
      })();
      // @ts-ignore Deno Edge Runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(bgTask);
      } else {
        // Fallback: don't block the response, but we have no waitUntil guarantee.
        bgTask.catch(() => {});
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("Audio processing failed", e);
    if (currentId) {
      await admin.from("songs").update({
        status: "failed",
        error_message: `Audio processing failed: ${(e as Error).message}`,
      }).eq("id", currentId).neq("status", "completed");
    }
    return new Response("error", { status: 500 });
  }
});
