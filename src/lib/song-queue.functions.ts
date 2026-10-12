import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Runs a staged song (draft row with an `orchestration` plan) entirely on the
 * server: lyrics, then the music engine. The phone only watches the row; if
 * this request dies, the background worker resumes from the same plan.
 */
export const runQueuedSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ songId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("songs")
      .select("id")
      .eq("id", data.songId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!own) return { ok: false, error: "Song not found" };
    const { getRequest } = await import("@tanstack/react-start/server");
    const auth = getRequest()?.headers.get("authorization")?.replace("Bearer ", "");
    const { orchestrateSong } = await import("./song-orchestrator.server");
    return orchestrateSong(data.songId, auth ? { Authorization: `Bearer ${auth}` } : null);
  });
