import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PublicSharedTrack = {
  id: string;
  title: string;
  lyrics: string | null;
  audioUrl: string;
};

export const getPublicSharedTrack = createServerFn({ method: "GET" })
  .validator((data) => z.object({ songId: z.string().uuid() }).parse(data))
  .handler(async ({ data }): Promise<PublicSharedTrack | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("id,title,lyrics,audio_path,status,is_public,revealed")
      .eq("id", data.songId)
      .eq("status", "completed")
      .eq("is_public", true)
      .neq("revealed", false)
      .maybeSingle();

    if (error || !song?.audio_path) return null;

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("song-files")
      .createSignedUrl(song.audio_path, 60 * 60);
    if (signError || !signed?.signedUrl) return null;

    return {
      id: song.id,
      title: song.title || "OG B0T track",
      lyrics: song.lyrics,
      audioUrl: signed.signedUrl,
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
      .select("id,title,style,cover_url,audio_path")
      .eq("status", "completed")
      .eq("is_public", true)
      .neq("revealed", false)
      .not("audio_path", "is", null)
      .order("completed_at", { ascending: false })
      .limit(30);
    const rows = (songs ?? []).filter((s) => s.audio_path);
    if (rows.length === 0) return [];
    const { data: signed } = await supabaseAdmin.storage
      .from("song-files")
      .createSignedUrls(rows.map((r) => r.audio_path as string), 60 * 60);
    const urlBy = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    return rows
      .map((r) => ({
        id: r.id,
        title: r.title || "OG B0T track",
        style: r.style,
        coverUrl: r.cover_url,
        audioUrl: urlBy.get(r.audio_path as string) ?? "",
      }))
      .filter((r) => r.audioUrl);
  },
);
