// Owner unlock: charges `coins_per_full_unlock` and flips songs.unlocked=true.
// Community unlock (non-owner downloading another user's revealed track):
//   charges 3 OG coins from the buyer — 2 are burnt, 1 is transferred to the
//   song's creator as a loyalty royalty. Records an unlocked_songs ledger row
//   so song-url mode:"full" purpose:"download" can issue the signed URL.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

const COMMUNITY_COST = 3;
const COMMUNITY_ROYALTY = 1; // remainder (COMMUNITY_COST - COMMUNITY_ROYALTY) is burnt

function unlockError(err: { message?: string }) {
  if (String(err.message ?? "").includes("insufficient_coins")) {
    return jsonResponse({ error: "Insufficient coins", code: "insufficient_coins" }, 402);
  }
  return jsonResponse({ error: err.message ?? "Unlock failed" }, 500);
}

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
      .select("id, user_id, status, unlocked, audio_path, revealed, title")
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
      const reference = `community_unlock:${song_id}`;
      const { data: result, error: uErr } = await admin.rpc("unlock_song_with_coins", {
        _buyer: user.id,
        _song_id: song_id,
        _cost: COMMUNITY_COST,
        _royalty: COMMUNITY_ROYALTY,
        _source: "community_purchase",
        _reference: reference,
      });
      if (uErr) return unlockError(uErr);
      if (result?.already) return jsonResponse({ ok: true, already: true, cost: COMMUNITY_COST });
      const balance = result?.balance;

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
    if (song.unlocked) return jsonResponse({ ok: true, already: true });

    const { data: row } = await admin
      .from("app_settings").select("value").eq("key", "coins_per_full_unlock").maybeSingle();
    const cost = typeof row?.value === "number" ? row.value : 5;

    const { data: result, error: uErr } = await admin.rpc("unlock_song_with_coins", {
      _buyer: user.id,
      _song_id: song_id,
      _cost: cost,
      _royalty: 0,
      _source: "coins",
      _reference: `unlock:${song_id}`,
    });
    if (uErr) return unlockError(uErr);
    if (result?.already) return jsonResponse({ ok: true, already: true });
    const balance = result?.balance;

    return jsonResponse({ ok: true, coin_balance: balance, cost });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
