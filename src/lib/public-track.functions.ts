import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PublicSharedTrack = {
  id: string;
  title: string;
  lyrics: string | null;
  audioUrl: string;
  /** The track's cover art, when it has one. */
  coverUrl?: string | null;
  /** Being remade after an edit: no audio yet, the page checks back. */
  pending?: boolean;
};

export const getPublicSharedTrack = createServerFn({ method: "GET" })
  .validator((data) => z.object({ songId: z.string().uuid() }).parse(data))
  .handler(async ({ data }): Promise<PublicSharedTrack | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("id,title,lyrics,audio_path,drive_audio_id,status,is_public,revealed,cover_url")
      .eq("id", data.songId)
      .eq("is_public", true)
      .neq("revealed", false)
      .maybeSingle();

    if (error || !song) return null;
    // An edit re-makes the track in place: the link works again in a minute or two.
    if (song.status === "pending" || song.status === "processing") {
      return {
        id: song.id,
        title: song.title || "OG B0T track",
        lyrics: null,
        audioUrl: "",
        pending: true,
      };
    }
    if (song.status !== "completed" || !song.audio_path) return null;

    // From the Boss's Drive when the song is kept there (song-audio.server.ts).
    const { fullSongUrl } = await import("@/lib/song-audio.server");
    const audioUrl = await fullSongUrl(supabaseAdmin, song, 60 * 60);
    if (!audioUrl) return null;

    return {
      id: song.id,
      title: song.title || "OG B0T track",
      lyrics: song.lyrics,
      audioUrl,
      coverUrl: /^https:\/\//.test(song.cover_url ?? "") ? song.cover_url : null,
    };
  });

export type PublicCommunityTrack = {
  id: string;
  title: string;
  style: string | null;
  coverUrl: string | null;
  audioUrl: string;
};

/** Public landing playlist: completed, public, revealed tracks only, short-lived signed URLs. */
export const listPublicCommunityTracks = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicCommunityTrack[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: songs } = await supabaseAdmin
      .from("songs")
      .select("id,title,style,cover_url,audio_path,drive_audio_id")
      .eq("status", "completed")
      .eq("is_public", true)
      .neq("revealed", false)
      .not("audio_path", "is", null)
      .order("completed_at", { ascending: false })
      .limit(30);
    const rows = (songs ?? []).filter((s) => s.audio_path);
    if (rows.length === 0) return [];
    const { fullSongUrls } = await import("@/lib/song-audio.server");
    const urlBy = await fullSongUrls(supabaseAdmin, rows, 60 * 60);
    return rows
      .map((r) => ({
        id: r.id,
        title: r.title || "OG B0T track",
        style: r.style,
        coverUrl: r.cover_url,
        audioUrl: urlBy.get(r.id) ?? "",
      }))
      .filter((r) => r.audioUrl);
  },
);
