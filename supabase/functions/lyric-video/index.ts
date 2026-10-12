// Lyric video pipeline: renders an MP4 with lyrics burned in over the song's cover art
// (or a gradient fallback) timed to the full audio track.
//
// Actions (POST body { song_id, action }):
//   - "status"        → returns current lyric_video_status + paths + unlocked flag
//   - "render_preview"→ ensures a 30s "PREVIEW" watermarked clip exists; returns signed URL
//   - "unlock"        → charges `coins_per_lyric_video` coins idempotently, flips
//                       lyric_video_unlocked=true, kicks off full render
//   - "url"           → returns short-lived signed URL for preview or full
//
// Rendering uses ffmpeg.wasm (single-thread core, no SharedArrayBuffer) loaded from
// a CDN. Deno edge runtime is constrained — if the renderer fails we surface
// `render_failed` and auto-refund any charge so the user is never billed for a
// missing video.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

const BUCKET = "song-files";

type Mode = "preview" | "full";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const userId = auth.user.id;

    const body = await req.json().catch(() => ({}));
    const song_id: string | undefined = body?.song_id;
    const action: string = body?.action ?? "status";
    if (!song_id) return jsonResponse({ error: "Missing song_id" }, 400);

    const admin = adminClient();
    const { data: song } = await admin
      .from("songs")
      .select(
        "id, user_id, title, lyrics, cover_url, audio_path, sample_path, status, unlocked, duration_seconds, lyric_video_status, lyric_video_preview_path, lyric_video_full_path, lyric_video_unlocked, lyric_video_error",
      )
      .eq("id", song_id)
      .maybeSingle();
    if (!song || song.user_id !== userId) return jsonResponse({ error: "Not found" }, 404);
    if (song.status !== "completed") return jsonResponse({ error: "Song not ready" }, 409);
    if (!song.unlocked)
      return jsonResponse({ error: "Unlock the MP3 first", code: "mp3_locked" }, 403);

    if (action === "status") {
      return jsonResponse({
        status: song.lyric_video_status,
        unlocked: song.lyric_video_unlocked,
        has_preview: !!song.lyric_video_preview_path,
        has_full: !!song.lyric_video_full_path,
        error: song.lyric_video_error,
      });
    }

    if (action === "url") {
      const mode: Mode = body?.mode === "full" ? "full" : "preview";
      if (mode === "full" && !song.lyric_video_unlocked) {
        return jsonResponse({ error: "Lyric video locked", code: "locked" }, 403);
      }
      const path = mode === "full" ? song.lyric_video_full_path : song.lyric_video_preview_path;
      if (!path) return jsonResponse({ error: "Not rendered yet", code: "not_ready" }, 409);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ url: data.signedUrl, mode });
    }

    if (action === "render_preview") {
      if (song.lyric_video_preview_path) {
        const { data } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(song.lyric_video_preview_path, 60 * 10);
        return jsonResponse({ url: data?.signedUrl, status: "completed", cached: true });
      }
      const out = await renderAndStore(song, "preview", admin);
      if (!out.ok) return jsonResponse({ error: out.error, code: "render_failed" }, 500);
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(out.path!, 60 * 10);
      return jsonResponse({ url: data?.signedUrl, status: "completed" });
    }

    if (action === "unlock") {
      // Settings: cost
      const { data: row } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "coins_per_lyric_video")
        .maybeSingle();
      const cost = typeof row?.value === "number" ? row.value : 5;

      const reference = `lyric_video:${song_id}`;
      let charged = false;
      if (!song.lyric_video_unlocked) {
        // Idempotency: marker row protects against double-charge on rapid retries.
        const { data: existing } = await admin
          .from("coin_transactions")
          .select("id")
          .eq("reference", reference)
          .eq("type", "lyric_video_unlock")
          .maybeSingle();
        if (!existing) {
          // Insert marker FIRST so a concurrent retry sees it before we deduct.
          const { error: markErr } = await admin.from("coin_transactions").insert({
            user_id: userId,
            amount: 0,
            type: "lyric_video_unlock",
            reference,
          });
          if (markErr) {
            // Likely a concurrent request beat us to it — treat as already-charged.
          } else {
            const { error: dErr } = await admin.rpc("deduct_coins", {
              p_user: userId,
              p_amount: cost,
              p_reference: reference,
            });
            if (dErr) {
              // Roll back the marker so the user can retry after topping up.
              await admin
                .from("coin_transactions")
                .delete()
                .eq("reference", reference)
                .eq("type", "lyric_video_unlock");
              const msg = dErr.message?.includes("insufficient_coins")
                ? "Not enough coins"
                : (dErr.message ?? "Charge failed");
              return jsonResponse({ error: msg, code: "charge_failed" }, 402);
            }
            charged = true;
          }
        }
        await admin.from("songs").update({ lyric_video_unlocked: true }).eq("id", song_id);
      }

      // Render the full version (or reuse if already there)
      let fullPath = song.lyric_video_full_path as string | null;
      if (!fullPath) {
        const out = await renderAndStore(song, "full", admin);
        if (!out.ok) {
          // Refund the charge so user is never billed for a missing video
          if (charged) {
            await admin.rpc("refund_generation_charge", {
              p_user: userId,
              p_amount: cost,
              p_reference: `refund:lyric_video:${song_id}`,
            });
            await admin.from("songs").update({ lyric_video_unlocked: false }).eq("id", song_id);
          }
          return jsonResponse({ error: out.error, code: "render_failed", refunded: charged }, 500);
        }
        fullPath = out.path!;
      }

      const { data } = await admin.storage.from(BUCKET).createSignedUrl(fullPath, 60 * 10);
      return jsonResponse({ url: data?.signedUrl, status: "completed", cost: charged ? cost : 0 });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});

// ---------- Renderer ----------

type SongRow = {
  id: string;
  title: string | null;
  lyrics: string | null;
  cover_url: string | null;
  audio_path: string | null;
  sample_path: string | null;
  duration_seconds: number | null;
};

async function renderAndStore(
  song: SongRow,
  mode: Mode,
  admin: ReturnType<typeof adminClient>,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const setProgress = async (progress: number, stage: string) => {
    await admin
      .from("songs")
      .update({
        lyric_video_status: "processing",
        lyric_video_progress: Math.max(0, Math.min(100, Math.round(progress))),
        lyric_video_stage: stage,
        lyric_video_error: null,
      })
      .eq("id", song.id);
  };
  await setProgress(2, mode === "preview" ? "Queued preview render" : "Queued full render");

  try {
    await setProgress(8, "Downloading audio");
    const audioPath = mode === "full" ? song.audio_path : (song.sample_path ?? song.audio_path);
    if (!audioPath) throw new Error("Audio not available");
    const { data: audioBlob, error: dlErr } = await admin.storage.from(BUCKET).download(audioPath);
    if (dlErr || !audioBlob) throw new Error(dlErr?.message ?? "Audio download failed");
    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());

    await setProgress(18, "Fetching cover art");
    let coverBytes: Uint8Array | null = null;
    if (song.cover_url) {
      try {
        const r = await fetch(song.cover_url);
        if (r.ok) coverBytes = new Uint8Array(await r.arrayBuffer());
      } catch {
        /* fall back to gradient */
      }
    }

    await setProgress(25, "Building subtitles");
    const fullDuration = Math.max(15, song.duration_seconds ?? 180);
    const duration = mode === "preview" ? 30 : fullDuration;
    const lyricsForRender =
      mode === "preview"
        ? sliceLyricsForPreview(song.lyrics ?? "", duration, fullDuration)
        : (song.lyrics ?? "");
    const ass = buildAssSubtitles(lyricsForRender, duration, song.title ?? "", mode === "preview");

    await setProgress(30, "Rendering video");
    const mp4 = await renderMp4({
      audioBytes,
      coverBytes,
      assText: ass,
      duration,
      onProgress: (pct) => {
        // Map ffmpeg's 0..1 to the 30..90 band reserved for encoding.
        const mapped = 30 + Math.max(0, Math.min(1, pct)) * 60;
        // Fire-and-forget — don't block ffmpeg loop on the DB write.
        admin
          .from("songs")
          .update({
            lyric_video_progress: Math.round(mapped),
            lyric_video_stage: "Encoding frames",
          })
          .eq("id", song.id)
          .then(
            () => {},
            () => {},
          );
      },
    });

    await setProgress(92, "Uploading MP4");
    const outPath = `${song.id}/lyric-${mode}-${Date.now()}.mp4`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(outPath, mp4, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (upErr) throw upErr;

    const update: Record<string, unknown> = {
      lyric_video_status: "completed",
      lyric_video_rendered_at: new Date().toISOString(),
      lyric_video_error: null,
      lyric_video_progress: 100,
      lyric_video_stage: mode === "preview" ? "Preview ready" : "Full video ready",
    };
    update[mode === "preview" ? "lyric_video_preview_path" : "lyric_video_full_path"] = outPath;
    await admin.from("songs").update(update).eq("id", song.id);

    return { ok: true, path: outPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("songs")
      .update({
        lyric_video_status: "failed",
        lyric_video_error: msg,
        lyric_video_stage: "Render failed",
      })
      .eq("id", song.id);
    return { ok: false, error: msg };
  }
}

function sliceLyricsForPreview(
  lyrics: string,
  previewDuration: number,
  fullDuration: number,
): string {
  const lines = lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const ratio = Math.min(1, previewDuration / Math.max(1, fullDuration));
  const take = Math.max(1, Math.min(lines.length, Math.ceil(lines.length * ratio)));
  return lines.slice(0, take).join("\n");
}

function buildAssSubtitles(
  lyrics: string,
  duration: number,
  title: string,
  watermark: boolean,
): string {
  const lines = lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) lines.push(title || "♪ Instrumental ♪");
  const per = duration / lines.length;
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, "0");
    return `${h}:${String(m).padStart(2, "0")}:${sec}`;
  };
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginV
Style: Lyric,Arial,46,&H00FFFFFF,&H00000000,&H88000000,1,3,1,5,40
Style: Mark,Arial,28,&H88FFFFFF,&H00000000,&H00000000,1,2,0,9,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = lines
    .map((line, i) => {
      const start = fmt(i * per);
      const end = fmt(Math.min(duration, (i + 1) * per));
      const safe = line.replace(/[{}\\]/g, "").slice(0, 120);
      return `Dialogue: 0,${start},${end},Lyric,,0,0,0,,${safe}`;
    })
    .join("\n");
  const mark = watermark ? `\nDialogue: 0,0:00:00.00,${fmt(duration)},Mark,,0,0,0,,PREVIEW` : "";
  return header + events + mark + "\n";
}

async function renderMp4(args: {
  audioBytes: Uint8Array;
  coverBytes: Uint8Array | null;
  assText: string;
  duration: number;
  onProgress?: (pct: number) => void;
}): Promise<Uint8Array> {
  const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10");
  const ff = new FFmpeg();
  await ff.load({
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
  });

  if (args.onProgress) {
    try {
      ff.on("progress", ({ progress }: { progress: number }) => {
        if (typeof progress === "number" && isFinite(progress)) args.onProgress!(progress);
      });
    } catch {
      /* progress API optional */
    }
  }

  await ff.writeFile("audio.mp3", args.audioBytes);
  await ff.writeFile("subs.ass", new TextEncoder().encode(args.assText));

  const inputs: string[] = [];
  if (args.coverBytes) {
    await ff.writeFile("cover.jpg", args.coverBytes);
    inputs.push("-loop", "1", "-i", "cover.jpg");
  } else {
    inputs.push("-f", "lavfi", "-i", `color=c=0x0a0a14:s=720x720:d=${args.duration}`);
  }
  inputs.push("-i", "audio.mp3");

  await ff.exec([
    ...inputs,
    "-vf",
    "ass=subs.ass,scale=720:720",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "24",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-t",
    String(args.duration),
    "output.mp4",
  ]);

  const data = await ff.readFile("output.mp4");
  return data as Uint8Array;
}
