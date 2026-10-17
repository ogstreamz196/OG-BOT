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
import { hostAllowed, materialiseClips } from "../_shared/suno-materialise.ts";
import { extractVocalUrl, vocalRemovalFailed } from "../_shared/nasheed-stems.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function expectedToken(songId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(songId));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function notifyTelegram(admin: any, song: any) {
  const { data: prof } = await admin
    .from("profiles")
    .select("telegram_chat_id")
    .eq("id", song.user_id)
    .maybeSingle();
  const chatId = prof?.telegram_chat_id;
  if (!chatId) return;
  const botToken = Deno.env.get("OG_BOT_TOKEN");
  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const url = botToken
    ? `https://api.telegram.org/bot${botToken}/sendMessage`
    : "https://connector-gateway.lovable.dev/telegram/sendMessage";
  if (!botToken && (!tgKey || !lovableKey)) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!botToken) {
    headers.Authorization = `Bearer ${lovableKey}`;
    headers["X-Connection-Api-Key"] = tgKey!;
  }
  const title = String(song.title || "Your track").replace(/[<>&]/g, "");
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: "HTML",
      text: `🎵 <b>Track ready!</b>\n\n<b>${title}</b> is done and waiting in your library. Type /tracks anytime to see your latest songs.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Listen now", url: `https://ogbot.co.uk/library/${song.id}` }],
        ],
      },
    }),
  });
}

function background(task: Promise<unknown>) {
  // @ts-expect-error Deno Edge Runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-expect-error Deno global
    EdgeRuntime.waitUntil(task);
  } else {
    task.catch(() => {});
  }
}

/**
 * Nasheed vocal separation finished: the acapella becomes the track's only
 * audio (sample + full file), replacing nothing else; the mix was never saved.
 */
async function handleStems(admin: any, song: any, payload: any): Promise<Response> {
  if (!song.is_nasheed) return new Response("ignored", { status: 200 });
  const stemTask =
    payload?.data?.task_id ?? payload?.data?.taskId ?? payload?.task_id ?? payload?.taskId ?? null;
  if (song.stem_task_id && stemTask && String(stemTask) !== String(song.stem_task_id)) {
    return new Response("stale", { status: 200 });
  }
  const vocalClipId = `${song.stem_source_clip_id ?? song.id}:vocals`;
  if (song.status === "completed" && song.suno_clip_id === vocalClipId) {
    return new Response("already", { status: 200 });
  }
  if (vocalRemovalFailed(payload)) {
    console.error("Vocal separation failed", song.id, JSON.stringify(payload).slice(0, 400));
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
    return new Response("stems-failed", { status: 200 });
  }
  const vocalUrl = extractVocalUrl(payload);
  if (!vocalUrl) return new Response("waiting", { status: 200 });
  if (!hostAllowed(vocalUrl)) {
    console.error("Vocal file host not on the allow-list:", new URL(vocalUrl).hostname);
    return new Response("host-rejected", { status: 200 });
  }
  const result = await materialiseClips(
    admin,
    // Fill the track itself with the acapella (never a sibling, never the mix).
    { ...song, is_nasheed: false, sample_path: null, audio_path: null },
    [
      {
        audioUrl: vocalUrl,
        clipId: vocalClipId,
        coverUrl: song.cover_url,
        title: song.title,
        duration: song.duration_seconds,
      },
    ],
    { scheduleBackground: background },
  );
  if (result.parentCompleted) {
    await admin
      .from("songs")
      .update({ failure_class: null, next_retry_at: null, stream_audio_url: null })
      .eq("id", song.id);
    await notifyTelegram(admin, song).catch((e) => console.warn("telegram notify failed", e));
  }
  return new Response(result.parentCompleted ? "ok" : "vocal-download-failed", { status: 200 });
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
  try {
    payload = await req.json();
  } catch {
    /* tolerate empty */
  }
  console.log("Suno callback for", songId, JSON.stringify(payload).slice(0, 800));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: parentSong } = await admin.from("songs").select("*").eq("id", songId).single();
  if (!parentSong) return new Response("Song not found", { status: 404 });

  // Nasheed: the vocal-separation job for Take 1 has finished.
  if (url.searchParams.get("stage") === "stems") {
    return await handleStems(admin, parentSong, payload);
  }

  // Failure callback
  const callbackType = payload?.data?.callbackType || payload?.callbackType;
  if (callbackType === "error" || (payload?.code && payload.code !== 200)) {
    if (parentSong.status === "completed" || parentSong.status === "failed") {
      console.log("Skipping refund — song already terminal:", parentSong.status);
      return new Response("ok", { status: 200 });
    }
    const refundAmt = 0;
    const rawReason = payload?.msg || payload?.message || "Suno reported failure";
    const terminal = isModerationRejection(rawReason);
    await admin
      .from("songs")
      .update({
        status: "failed",
        error_message: terminal
          ? MODERATION_MESSAGE
          : "Retrying automatically after a temporary music-engine problem.",
        failure_class: terminal ? "terminal" : "retryable",
        next_retry_at: terminal ? null : new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", songId);
    if (refundAmt > 0) {
      await admin.from("coin_transactions").insert({
        user_id: parentSong.user_id,
        amount: refundAmt,
        type: "refund",
        reference: songId,
      });
      const { data: prof } = await admin
        .from("profiles")
        .select("coin_balance")
        .eq("id", parentSong.user_id)
        .single();
      await admin
        .from("profiles")
        .update({ coin_balance: (prof?.coin_balance ?? 0) + refundAmt })
        .eq("id", parentSong.user_id);
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
    streamUrl:
      c?.stream_audio_url || c?.streamAudioUrl || c?.streamAudioURL || c?.source_stream_audio_url,
    coverUrl: c?.image_url || c?.imageUrl || c?.cover_url,
    title: c?.title,
    duration: c?.duration,
    clipId: c?.id || c?.clip_id,
  }));

  const callbackTaskId =
    payload?.data?.task_id || payload?.data?.taskId || payload?.task_id || payload?.taskId || null;
  if (callbackTaskId && !parentSong.suno_task_id) {
    await admin.from("songs").update({ suno_task_id: callbackTaskId }).eq("id", songId);
  }

  // Early "first"/"text" callback: Suno only has the stream URL, not the final
  // file. Persist the stream URL so the UI can offer a live Suno-style preview
  // while we wait for the "complete" callback to deliver the downloadable file.
  if (callbackType === "first" || callbackType === "text") {
    const firstStream = clipsRaw.find((c) => c.streamUrl && hostAllowed(c.streamUrl!));
    // A Nasheed never previews the mix: only the separated vocals are played.
    if (firstStream?.streamUrl && !parentSong.stream_audio_url && !parentSong.is_nasheed) {
      await admin
        .from("songs")
        .update({
          stream_audio_url: firstStream.streamUrl,
          cover_url: firstStream.coverUrl ?? parentSong.cover_url,
          title: firstStream.title ?? parentSong.title,
        })
        .eq("id", songId);
      console.log("Stream URL stored for live preview:", songId);
    }
    return new Response("streaming", { status: 200 });
  }

  const clips = clipsRaw.filter((c) => !!c.audioUrl && hostAllowed(c.audioUrl!));

  if (clips.length === 0) {
    console.log("No audio clips ready yet (or all rejected by host allow-list)");
    return new Response("waiting", { status: 200 });
  }

  try {
    const sunoKey = Deno.env.get("SUNO_API_KEY");
    const result = await materialiseClips(admin, parentSong, clips, {
      nasheedStems: sunoKey
        ? {
            apiKey: sunoKey,
            callbackUrl: `${SUPABASE_URL}/functions/v1/suno-callback?song_id=${songId}&token=${token}&stage=stems`,
            taskId: parentSong.suno_task_id ?? callbackTaskId,
          }
        : undefined,
      scheduleBackground: (task) => {
        // @ts-expect-error Deno Edge Runtime
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          // @ts-expect-error Deno global
          EdgeRuntime.waitUntil(task);
        } else {
          task.catch(() => {});
        }
      },
    });

    console.log("Materialise result for", songId, JSON.stringify(result));

    // Every take Suno produced was broken on their CDN and nothing landed.
    // Mark the row failed with a recoverable message so the retry button can
    // re-check the same task later (the CDN usually heals within minutes).
    if (!result.parentCompleted && result.completed === 0 && result.skipped.length === 0) {
      await admin
        .from("songs")
        .update({
          status: "failed",
          error_message: "Retrying automatically while the music engine's file server recovers.",
          failure_class: "recoverable_cdn",
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq("id", songId);
      return new Response("clip-download-failed", { status: 200 });
    }

    // Ping the owner on Telegram once, on the first transition to completed.
    if (result.parentCompleted && parentSong.status !== "completed") {
      await notifyTelegram(admin, parentSong).catch((e) =>
        console.warn("telegram notify failed", e),
      );
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("Audio processing failed", e);
    await admin
      .from("songs")
      .update({
        status: "failed",
        error_message: `Audio processing failed: ${(e as Error).message}`,
        failure_class: "retryable",
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", songId);
    return new Response("error", { status: 500 });
  }
});
