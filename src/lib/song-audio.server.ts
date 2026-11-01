// The link for playing or downloading a full song: from the Boss's Google
// Drive when the song is kept there (song-audio-link.ts, streamed by
// /api/public/song-audio), else a short-lived link to the stored file.
// Callers check the person may have the full song first.
import { SITE_URL } from "./seo";
import { songAudioUrl } from "./song-audio-link";

type Admin = any;

export type FullSong = {
  id: string;
  audio_path: string | null;
  drive_audio_id?: string | null;
};

const safeFile = (name: string) => {
  const n = name.replace(/[^\w.\- ]+/g, "").slice(0, 120) || "track.mp3";
  return n.toLowerCase().endsWith(".mp3") ? n : `${n}.mp3`;
};

export async function fullSongUrl(
  admin: Admin,
  song: FullSong,
  ttlSeconds: number,
  downloadName?: string,
): Promise<string | null> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const name = downloadName ? safeFile(downloadName) : undefined;
  if (song.drive_audio_id && secret)
    return songAudioUrl(secret, SITE_URL, song.id, ttlSeconds, name);
  if (!song.audio_path) return null;
  if (/^https?:\/\//.test(song.audio_path)) return song.audio_path;
  const { data } = await admin.storage
    .from("song-files")
    .createSignedUrl(song.audio_path, ttlSeconds, name ? { download: name } : undefined);
  return (data as { signedUrl?: string } | null)?.signedUrl ?? null;
}

/** Several songs at once (the public playlist). */
export async function fullSongUrls(
  admin: Admin,
  songs: FullSong[],
  ttlSeconds: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stored: FullSong[] = [];
  for (const s of songs) {
    if (s.drive_audio_id && secret)
      out.set(s.id, await songAudioUrl(secret, SITE_URL, s.id, ttlSeconds));
    else if (s.audio_path) stored.push(s);
  }
  if (stored.length) {
    const { data } = await admin.storage.from("song-files").createSignedUrls(
      stored.map((s) => s.audio_path as string),
      ttlSeconds,
    );
    const byPath = new Map(
      ((data ?? []) as { path: string; signedUrl: string }[]).map((x) => [x.path, x.signedUrl]),
    );
    for (const s of stored) {
      const u = byPath.get(s.audio_path as string);
      if (u) out.set(s.id, u);
    }
  }
  return out;
}
