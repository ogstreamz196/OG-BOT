import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Finishes songs whose phone dropped off mid-creation: writes the lyrics and
 * hands them to the music engine on the server, using the exact saved answers.
 */
type Plan = { lyrics?: Record<string, unknown>; suno?: Record<string, unknown>; stage?: string };

async function setStage(db: any, id: string, plan: Plan, stage: string) {
  await db.from("songs").update({ orchestration: { ...plan, stage } }).eq("id", id);
}

/**
 * Runs one staged song on the server: lyrics, then the music engine, writing
 * the current stage into the row so the cooking screen can follow along.
 * `userAuth` = the owner's own bearer; otherwise the cron retry token is used.
 */
export async function orchestrateSong(
  songId: string,
  userAuth: Record<string, string> | null,
  retryToken = "",
): Promise<{ ok: boolean; error?: string }> {
  const backendUrl = process.env["SUPABASE_URL"];
  const anon = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!backendUrl || !anon) return { ok: false, error: "Backend not configured" };
  const db = supabaseAdmin as any;
  const { data: song } = await db
    .from("songs")
    .select("id, user_id, lyrics, status, orchestration")
    .eq("id", songId)
    .maybeSingle();
  if (!song?.orchestration) return { ok: true };
  if (song.status !== "draft") return { ok: true };
  const plan = song.orchestration as Plan;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: anon,
    ...(userAuth ?? {
      Authorization: `Bearer ${anon}`,
      "x-ogbot-retry-token": retryToken,
      "x-og-user-id": String(song.user_id),
    }),
  };
  // Keep the background worker off this song while we're working on it.
  await db
    .from("songs")
    .update({ orchestration_due_at: new Date(Date.now() + 6 * 60_000).toISOString(), error_message: null })
    .eq("id", songId);
  try {
    let lyrics = typeof song.lyrics === "string" && song.lyrics.trim() ? song.lyrics : "";
    if (!lyrics) {
      await setStage(db, songId, plan, "lyrics");
      let last = "";
      for (let attempt = 0; attempt < 2 && !lyrics; attempt++) {
        const r = await fetch(`${backendUrl}/functions/v1/generate-lyrics`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...(plan.lyrics ?? {}), song_id: songId }),
          signal: AbortSignal.timeout(150_000),
        });
        const body = (await r.json().catch(() => ({}))) as { lyrics?: string };
        if (r.ok && body.lyrics) lyrics = body.lyrics;
        else last = `lyrics ${r.status}`;
      }
      if (!lyrics) throw new Error(last || "lyrics failed");
      await db.from("songs").update({ lyrics }).eq("id", songId);
    }
    await setStage(db, songId, plan, "submitting");
    // Pick up any title change the app made while lyrics were cooking.
    const { data: fresh } = await db.from("songs").select("title, prompt").eq("id", songId).maybeSingle();
    const g = await fetch(`${backendUrl}/functions/v1/suno-generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(plan.suno ?? {}),
        title: fresh?.title ?? plan.suno?.title ?? null,
        prompt: fresh?.prompt ?? plan.suno?.prompt,
        song_id: songId,
        lyrics,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const gb = (await g.json().catch(() => ({}))) as {
      accepted?: boolean;
      error?: string;
      code?: string;
    };
    if (g.status === 402) {
      // Not enough coins to create: retrying will not help, so stop here.
      // suno-generate already put the song back as a draft with the message.
      await db
        .from("songs")
        .update({ orchestration: null, orchestration_due_at: null })
        .eq("id", songId);
      return { ok: false, error: gb.error || "Not enough coins" };
    }
    if (!g.ok && g.status !== 409) throw new Error(`music ${g.status}`);
    if (gb.accepted === false) throw new Error(gb.error || "music busy");
    await db.from("songs").update({ orchestration: null, error_message: null }).eq("id", songId);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("Song orchestration failed", songId, msg);
    await db
      .from("songs")
      .update({
        orchestration: { ...plan, stage: "retrying" },
        orchestration_due_at: new Date(Date.now() + 60_000).toISOString(),
        error_message: "Finishing in the background — no need to retype anything.",
      })
      .eq("id", songId);
    return { ok: false, error: msg };
  }
}

/**
 * Finishes songs whose phone dropped off mid-creation, using the exact saved answers.
 */
export async function resumeOrphanedSongs(retryToken: string): Promise<number> {
  const db = supabaseAdmin as any;
  const { data, error } = await db.rpc("claim_due_orchestrations", { p_limit: 2 });
  if (error) throw new Error(error.message);
  let resumed = 0;
  for (const song of (data ?? []) as Array<Record<string, any>>) {
    const r = await orchestrateSong(String(song.id), null, retryToken);
    if (r.ok) resumed++;
  }
  return resumed;
}

/** Songs stuck "cooking" with no scheduled check get queued for recovery. */
export async function queueStuckSongs(): Promise<void> {
  const db = supabaseAdmin as any;
  const cutoff = new Date(Date.now() - 12 * 60_000).toISOString();
  await db
    .from("songs")
    .update({ next_retry_at: new Date().toISOString(), failure_class: "retryable" })
    .in("status", ["processing", "pending"])
    .is("next_retry_at", null)
    .lt("generation_started_at", cutoff)
    .gt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .lt("retry_count", 5);
}

const FRIENDLY: Record<number, string> = {
  400: "rejected the request",
  401: "key is invalid",
  402: "is out of credit",
  403: "access is blocked",
  429: "hit its quota / rate limit",
};

/** Quiet Telegram heads-up to Boss when an AI key keeps failing (max once/hour per key). */
export async function alertKeyFailures(): Promise<number> {
  const db = supabaseAdmin as any;
  const { data: rows } = await db
    .from("ai_key_failures")
    .select("id, key_name, status")
    .is("alerted_at", null)
    .limit(200);
  if (!rows?.length) return 0;
  const now = new Date().toISOString();
  await db.from("ai_key_failures").update({ alerted_at: now }).in("id", rows.map((r: any) => r.id));
  const { data: recent } = await db
    .from("ai_key_failures")
    .select("key_name")
    .gt("alerted_at", new Date(Date.now() - 3600_000).toISOString())
    .lt("alerted_at", now);
  const quiet = new Set((recent ?? []).map((r: any) => r.key_name));
  const byKey = new Map<string, { n: number; status: number }>();
  for (const r of rows) {
    if (quiet.has(r.key_name)) continue;
    const e = byKey.get(r.key_name) ?? { n: 0, status: r.status };
    e.n++;
    byKey.set(r.key_name, e);
  }
  // Only alert on repeat failures, not a single blip.
  const lines = [...byKey].filter(([, v]) => v.n >= 2).map(
    ([k, v]) => `• <b>${k}</b> ${FRIENDLY[v.status] ?? `failed (${v.status})`} — ${v.n}× recently`,
  );
  if (!lines.length) return 0;
  const { data: roleRows } = await db.from("user_roles").select("user_id").in("role", ["admin", "boss"]);
  const ids = [...new Set((roleRows ?? []).map((r: any) => r.user_id))];
  const { data: bosses } = await db.from("profiles").select("telegram_chat_id").in("id", ids);
  const chats = [...new Set((bosses ?? []).map((b: any) => b.telegram_chat_id).filter(Boolean))];
  const { vipAckTelegram } = await import("@/lib/vip-ack.server");
  const text = `⚠️ <b>AI key warning</b>\n${lines.join("\n")}\nSongs keep working on the other keys. Check Boss Controls → API & Integrations.`;
  await Promise.all(
    chats.map((chat_id) =>
      vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML", disable_notification: true }),
    ),
  );
  return lines.length;
}
