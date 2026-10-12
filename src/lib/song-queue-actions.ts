import { supabase } from "@/integrations/supabase/client";
import { languageFromPrompt } from "@/lib/library-utils";
import { readInvokeError } from "@/lib/invoke-error";

/**
 * Shared actions for the generation queue / history surfaces:
 * delete a track (cancelling + refunding it first when it is still in flight)
 * and re-submit a failed track for generation.
 */

const ACTIVE = new Set(["pending", "processing"]);

/** Cancel (if in flight) then permanently delete the song row. */
export async function deleteQueuedSong(song: { id: string; status?: string | null }) {
  if (ACTIVE.has((song.status ?? "").toLowerCase())) {
    // Releases the concurrency slot (and refunds a paid edit) before we remove it.
    await supabase.functions.invoke("suno-cancel", { body: { song_id: song.id } });
  }
  const { error } = await supabase.from("songs").delete().eq("id", song.id);
  if (error) throw new Error(error.message);
}

/** Re-run generation for an existing (failed / cancelled) song row. */
export async function retryGeneration(songId: string) {
  const { data: song, error } = await supabase
    .from("songs")
    .select("id, prompt, lyrics, style, title, vocals_only, beat_path, portal_id")
    .eq("id", songId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!song) throw new Error("Track not found");

  const { data, error: genErr } = await supabase.functions.invoke("suno-generate", {
    body: {
      song_id: song.id,
      prompt: song.prompt,
      lyrics: song.lyrics,
      title: song.title,
      style: song.style,
      language: languageFromPrompt(song.prompt),
      vocals_only: !!song.vocals_only,
      beat_path: song.beat_path,
      portal_id: song.portal_id,
    },
  });
  if (genErr) throw new Error(await readInvokeError(genErr, "Could not restart generation"));
  if (data?.accepted === false) throw new Error(data.error || "Studio is busy — try again shortly");
  return data as { song_id?: string } | null;
}
