// Owner unlock: charges `coins_per_full_unlock` and flips songs.unlocked=true.
// Community unlock (non-owner downloading another user's revealed track):
//   charges 3 OG coins from the buyer — 2 are burnt, 1 is transferred to the
//   song's creator as a loyalty royalty. Records an unlocked_songs ledger row
//   so song-url mode:"full" purpose:"download" can issue the signed URL.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

const COMMUNITY_COST = 3;
const COMMUNITY_ROYALTY = 1; // remainder (COMMUNITY_COST - COMMUNITY_ROYALTY) is burnt

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const { user } = auth;

    const { song_id } = await req.json().catch(() => ({}));
    if (!song_id) return jsonResponse({ error: "Missing song_id" }, 400);

    const admin = adminClient();
    const { data: song } = await admin
      .from("songs")
      .select(
        "id, user_id, status, unlocked, audio_path, revealed, title, suno_task_id, is_variation",
      )
      .eq("id", song_id)
      .maybeSingle();
    if (!song) return jsonResponse({ error: "Not found" }, 404);
    if (song.status !== "completed") return jsonResponse({ error: "Song not ready" }, 409);

    const isOwner = song.user_id === user.id;

    // ─── Community unlock path (non-owner) ──────────────────────────────
    if (!isOwner) {
      if (song.revealed === false) {
        return jsonResponse({ error: "Song not available", code: "not_revealed" }, 404);
      }
      // One atomic purchase: claim, charge and royalty succeed or fail together,
      // so a double tap cannot charge twice and royalties are never lost.
      const { data: purchase, error: pErr } = await admin.rpc("unlock_community_track", {
        _buyer: user.id,
        _song_id: song_id,
        _cost: COMMUNITY_COST,
        _royalty: COMMUNITY_ROYALTY,
      });
      if (pErr) {
        if (/insufficient_coins/i.test(pErr.message)) {
          return jsonResponse({ error: "Insufficient coins", code: "insufficient_coins" }, 402);
        }
        if (/not_revealed/i.test(pErr.message)) {
          return jsonResponse({ error: "Song not available", code: "not_revealed" }, 404);
        }
        return jsonResponse({ error: "Could not unlock track", code: "unlock_failed" }, 409);
      }
      const result = (purchase ?? {}) as { already?: boolean; coin_balance?: number };
      if (result.already) return jsonResponse({ ok: true, already: true, cost: COMMUNITY_COST });
      const balance = result.coin_balance;

      // Celebrate with the creator: someone downloaded their track.
      await admin.from("user_notifications").insert({
        user_id: song.user_id,
        kind: "track_download",
        title: "Your track was downloaded!",
        body: `Someone just downloaded "${song.title ?? "your track"}" and you earned ${COMMUNITY_ROYALTY} loyalty OG coin.`,
        metadata: {
          song_id,
          coins: COMMUNITY_ROYALTY,
          downloader: user.id,
        },
      });

      return jsonResponse({
        ok: true,
        coin_balance: balance,
        cost: COMMUNITY_COST,
        royalty: COMMUNITY_ROYALTY,
        burnt: COMMUNITY_COST - COMMUNITY_ROYALTY,
      });
    }

    // ─── Owner unlock path (HQ download of own song) ────────────────────
    // Compatibility for older clients: one atomic charge includes Take 2 free.
    const { data, error } = await admin.rpc("purchase_owner_track", {
      p_user: user.id,
      p_song: song_id,
    });
    if (error) {
      const insufficient = /insufficient_coins/i.test(error.message);
      return jsonResponse({
        error: insufficient ? "Insufficient coins" : "Could not unlock track",
        code: insufficient ? "insufficient_coins" : "unlock_failed",
      }, insufficient ? 402 : 409);
    }
    return jsonResponse(data);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
