// Cancels an in-flight Suno generation: marks the song failed (never auto-retried)
// and refunds the edit fee if this run was a paid edit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { song_id } = await req.json();
    if (!song_id) return json({ error: "Missing song_id" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    // One atomic step: only one cancel wins, the song is marked terminal so the
    // auto-retry worker never resubmits it, and the refund is exactly the edit
    // fee charged for this run (creation itself is free), at most once.
    const { data, error } = await admin.rpc("cancel_song_generation", {
      p_user: user.id,
      p_song: song_id,
    });
    if (error) {
      console.error("cancel_song_generation failed", error.message);
      return json({ error: "Could not cancel this song. Please try again." }, 500);
    }
    const result = (data ?? {}) as { ok?: boolean; reason?: string; already?: boolean; refunded?: number };
    if (result.reason === "not_found") return json({ error: "Song not found" }, 404);
    if (result.reason === "forbidden") return json({ error: "Forbidden" }, 403);
    if (result.already) return json({ ok: true, already: true });

    return json({ ok: true, refunded: result.refunded ?? 0 });
  } catch (e) {
    console.error("suno-cancel error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
