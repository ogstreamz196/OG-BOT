import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Google Drive archive for finished tracks.
 *
 * Every completed (non-preview) song gets:
 *   • <title> - <id>.mp3      — the mastered audio
 *   • <title> - <id>.txt      — the lyrics sheet
 * stored inside a per-user folder under the OG BOT root folder, shared as
 * "anyone with the link can view" so users can download straight from Drive.
 */

const ROOT_FOLDER_ID = "1d5obQLuq7gLf2w-0f0Nk83KICyyGlxTo"; // OG BOT / Track Generations
const DRIVE_BASE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const DRIVE_UPLOAD = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3";

function gatewayHeaders(): Record<string, string> {
  const lovable = process.env.LOVABLE_API_KEY;
  const conn = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovable || !conn) throw new Error("Google Drive connector not configured");
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": conn,
  };
}

async function drive(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...gatewayHeaders() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`drive ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

function safeName(input: string): string {
  return (input || "track").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

async function ensureFolder(name: string, parentId: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const found = await drive(`${DRIVE_BASE}/files?q=${q}&fields=files(id,name)&pageSize=1`);
  const list = (await found.json()) as { files?: { id: string }[] };
  if (list.files?.length) return list.files[0].id;

  const created = await drive(`${DRIVE_BASE}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const folder = (await created.json()) as { id: string };
  return folder.id;
}

async function uploadFile(opts: {
  name: string;
  parentId: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ id: string; link: string | null }> {
  const metadata = { name: opts.name, parents: [opts.parentId], mimeType: opts.mimeType };
  const boundary = `----ogbot${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata,
    )}\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + opts.bytes.length + tail.length);
  body.set(head, 0);
  body.set(opts.bytes, head.length);
  body.set(tail, head.length + opts.bytes.length);

  const up = await drive(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = (await up.json()) as { id: string; webViewLink?: string };

  // Make it link-shareable so the owner (and anyone they share with) can download.
  await drive(`${DRIVE_BASE}/files/${file.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }).catch(() => undefined);

  return {
    id: file.id,
    link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
  };
}

export type DriveArchiveResult = {
  ok: boolean;
  reason?: string;
  audioLink?: string | null;
  lyricsLink?: string | null;
  alreadyArchived?: boolean;
};

export const archiveSongToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { songId: string; force?: boolean }) => ({
    songId: String(input.songId),
    force: Boolean(input.force),
  }))
  .handler(async ({ data, context }): Promise<DriveArchiveResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select(
        "id,user_id,title,status,audio_path,lyrics,is_variation,style,drive_audio_id,drive_audio_link,drive_lyrics_link",
      )
      .eq("id", data.songId)
      .maybeSingle();
    if (error || !song) return { ok: false, reason: "song_not_found" };

    if (song.user_id !== context.userId) {
      const { data: isDev } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "dev",
      });
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isDev && !isAdmin) return { ok: false, reason: "forbidden" };
    }

    if (song.status !== "complete" && song.status !== "completed") {
      return { ok: false, reason: "not_final" };
    }
    if (!song.audio_path) return { ok: false, reason: "no_audio" };
    if (song.drive_audio_id && !data.force) {
      return {
        ok: true,
        alreadyArchived: true,
        audioLink: song.drive_audio_link,
        lyricsLink: song.drive_lyrics_link,
      };
    }

    // Per-user folder keeps the archive tidy and easy to hand over.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name,email")
      .eq("id", song.user_id)
      .maybeSingle();
    const folderLabel = safeName(
      `${profile?.display_name || profile?.email || "user"} (${song.user_id.slice(0, 6)})`,
    );
    const userFolderId = await ensureFolder(folderLabel, ROOT_FOLDER_ID);

    let downloadUrl = song.audio_path;
    if (!/^https?:\/\//.test(song.audio_path)) {
      const { data: signed } = await supabaseAdmin.storage
        .from("song-files")
        .createSignedUrl(song.audio_path, 60 * 10);
      if (!signed?.signedUrl) return { ok: false, reason: "sign_failed" };
      downloadUrl = signed.signedUrl;
    }
    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) return { ok: false, reason: `download_${audioRes.status}` };
    const audioBytes = new Uint8Array(await audioRes.arrayBuffer());

    const base = `${safeName(song.title ?? "track")} - ${song.id}`;
    const audio = await uploadFile({
      name: `${base}.mp3`,
      parentId: userFolderId,
      mimeType: "audio/mpeg",
      bytes: audioBytes,
    });

    let lyrics: { id: string; link: string | null } | null = null;
    if (song.lyrics && song.lyrics.trim().length) {
      const sheet = [
        song.title ?? "Untitled",
        song.style ? `Style: ${song.style}` : null,
        `Track ID: ${song.id}`,
        "",
        song.lyrics,
      ]
        .filter(Boolean)
        .join("\n");
      lyrics = await uploadFile({
        name: `${base}.txt`,
        parentId: userFolderId,
        mimeType: "text/plain",
        bytes: new TextEncoder().encode(sheet),
      });
    }

    await supabaseAdmin
      .from("songs")
      .update({
        drive_audio_id: audio.id,
        drive_audio_link: audio.link,
        drive_lyrics_id: lyrics?.id ?? null,
        drive_lyrics_link: lyrics?.link ?? null,
        drive_archived_at: new Date().toISOString(),
      })
      .eq("id", song.id);

    return { ok: true, audioLink: audio.link, lyricsLink: lyrics?.link ?? null };
  });

/** Backfill: archive every completed track that has no Drive copy yet. */
export const backfillDriveArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => ({
    limit: Math.max(1, Math.min(50, Number(input?.limit ?? 10))),
  }))
  .handler(async ({ data, context }) => {
    const { data: isDev } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "dev",
    });
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("songs")
      .select("id")
      .in("status", ["complete", "completed"])
      .is("drive_audio_id", null)
      .not("audio_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (!isDev && !isAdmin) query = query.eq("user_id", context.userId);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    let archived = 0;
    const failures: string[] = [];
    for (const row of rows ?? []) {
      try {
        const res = await archiveSongToDrive({ data: { songId: row.id } });
        if (res.ok) archived += 1;
        else failures.push(`${row.id}: ${res.reason}`);
      } catch (e) {
        failures.push(`${row.id}: ${(e as Error).message}`);
      }
    }
    return { ok: true, considered: rows?.length ?? 0, archived, failures };
  });
