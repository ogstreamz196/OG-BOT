// Charges half (admin-configurable divisor) of coins_per_generation to reveal
// a hidden Suno alt-take. Used by both the instant "Reveal" button and the
// "Checkout basket" batch flow on the client (which calls this once per item).
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const song_id: string | undefined = body?.song_id;
  if (!song_id) return jsonResponse({ error: "Missing song_id" }, 400);

  const admin = adminClient();

  const { data: song } = await admin
    .from("songs")
    .select("id, user_id, is_variation, revealed")
    .eq("id", song_id)
    .single();
  if (!song || song.user_id !== user.id) return jsonResponse({ error: "Not found" }, 404);
  if (!song.is_variation) return jsonResponse({ error: "Not a variation" }, 400);
  if (song.revealed) return jsonResponse({ ok: true, already: true });

  // Pricing: flat "remake" price (app_settings.coins_per_remake, default 2).
  const { data: rows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["coins_per_remake"]);
  const map = new Map((rows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const raw = Number(map.get("coins_per_remake"));
  const cost = Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : 2;

  // Claim the reveal atomically first so double taps / retries can't charge twice.
  const { data: claimed, error: claimErr } = await admin
    .from("songs")
    .update({ revealed: true })
    .eq("id", song_id)
    .eq("user_id", user.id)
    .eq("revealed", false)
    .select("id");
  if (claimErr) return jsonResponse({ error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return jsonResponse({ ok: true, already: true });

  const { error: deductErr } = await admin.rpc("deduct_coins", {
    p_user: user.id,
    p_amount: cost,
    p_reference: `variation:${song_id}`,
  });
  if (deductErr) {
    await admin.from("songs").update({ revealed: false }).eq("id", song_id);
    return jsonResponse(
      { error: "Not enough coins for this remake", code: "insufficient_coins" },
      402,
    );
  }

  return jsonResponse({ ok: true, cost });
});
