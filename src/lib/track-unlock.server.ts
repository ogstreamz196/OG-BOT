import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** One-off card price (in pence) to unlock a full track without coins. */
export const TRACK_UNLOCK_PENCE = 99;
export const TRACK_UNLOCK_CURRENCY = "gbp";

export type GrantResult = { ok: true; already: boolean } | { ok: false; error: string };

/**
 * Marks a track as unlocked for a user after a successful one-off card
 * payment. Owners get `songs.unlocked = true` (full master + downloads);
 * non-owners get an `unlocked_songs` ledger row, which is what the
 * signed-URL function checks.
 */
export async function grantTrackUnlock(
  userId: string,
  songId: string,
  reference: string,
): Promise<GrantResult> {
  const { data: song, error: songErr } = await supabaseAdmin
    .from("songs")
    .select("id, user_id")
    .eq("id", songId)
    .maybeSingle();
  if (songErr) return { ok: false, error: songErr.message };
  if (!song) return { ok: false, error: "Track not found" };

  const { data: existing } = await supabaseAdmin
    .from("unlocked_songs")
    .select("id")
    .eq("user_id", userId)
    .eq("song_id", songId)
    .maybeSingle();

  if (song.user_id === userId) {
    const { error } = await supabaseAdmin.from("songs").update({ unlocked: true }).eq("id", songId);
    if (error) return { ok: false, error: error.message };
  }

  if (existing) {
    if (song.user_id === userId) {
      const { error } = await supabaseAdmin.rpc("sync_owner_track_bonus", { p_song: songId });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, already: true };
  }

  const { error: insErr } = await supabaseAdmin.from("unlocked_songs").insert({
    user_id: userId,
    song_id: songId,
    source: "card_one_off",
    cost_coins: 0,
    reference,
  });
  if (insErr && !String(insErr.message).includes("duplicate")) {
    return { ok: false, error: insErr.message };
  }
  return { ok: true, already: false };
}
