// Admin-only: re-runs Suno generation for a song without deducting coins.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUNO_API_KEY = Deno.env.get("SUNO_API_KEY")!;
const SUNO_API_URL = "https://apibox.erweima.ai/api/v1/generate";

async function callbackToken(songId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(songId));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const guard = await requireAdmin(req);
    if (guard.error) return guard.error;
    const { admin } = guard;

    const { song_id } = await req.json();
    if (!song_id) return jsonResponse({ error: "Missing song_id" }, 400);

    const { data: song, error } = await admin.from("songs").select("*").eq("id", song_id).single();
    if (error || !song) return jsonResponse({ error: "Song not found" }, 404);
    const s = song as Record<string, unknown>;

    await admin
      .from("songs")
      .update({
        status: "processing",
        generation_started_at: new Date().toISOString(),
        error_message: null,
        audio_path: null,
        sample_path: null,
        stream_audio_url: null,
        completed_at: null,
      })
      .eq("id", song_id);

    const callbackUrl = `${SUPABASE_URL}/functions/v1/suno-callback?song_id=${s.id}&token=${await callbackToken(String(s.id))}`;
    const sunoRes = await fetch(SUNO_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUNO_API_KEY}` },
      body: JSON.stringify({
        prompt: s.lyrics || s.prompt,
        style: s.style || undefined,
        title: (s.title as string | undefined) || "Untitled track",
        customMode: !!(s.style || s.lyrics || s.title),
        instrumental: false,
        model: "V4_5ALL",
        callBackUrl: callbackUrl,
      }),
    });
    const text = await sunoRes.text();
    if (!sunoRes.ok) {
      await admin
        .from("songs")
        .update({
          status: "failed",
          error_message: `Suno ${sunoRes.status}: ${text.slice(0, 200)}`,
        })
        .eq("id", song_id);
      return jsonResponse({ error: "Suno rejected", details: text.slice(0, 300) }, 502);
    }
    let body: { data?: { taskId?: string }; taskId?: string } = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const taskId = body?.data?.taskId ?? body?.taskId ?? null;
    await admin.from("songs").update({ suno_task_id: taskId }).eq("id", song_id);
    return jsonResponse({ ok: true, task_id: taskId });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
