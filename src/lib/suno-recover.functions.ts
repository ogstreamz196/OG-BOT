// "Recover this track" — what the retry/refresh button calls first.
//
// Asks the music engine what actually happened to a stuck job and rebuilds the
// track from whichever take is intact. Never spends coins.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RecoverOutcome =
  | "completed" // track is playable now
  | "pending" // engine still working
  | "failed" // engine failed — normal retry needed
  | "unavailable" // couldn't reach the engine
  | "no_task" // never reached the engine — normal retry needed
  | "not_found";

export type RecoverResult = {
  outcome: RecoverOutcome;
  recovered: boolean;
  takes?: number;
  message: string;
};

/** Engine states that mean "still rendering". */
const PENDING_STATES = ["PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS", "PROCESSING", "QUEUED"];

export const recoverStuckSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { songId: string }) => {
    if (!data?.songId || typeof data.songId !== "string") throw new Error("Missing songId");
    return { songId: data.songId };
  })
  .handler(async ({ data, context }): Promise<RecoverResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchTask, materialiseClips, backfillFullAudio } =
      await import("./suno-recover.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      storage: { from: (b: string) => any };
    };

    const { data: song } = await admin
      .from("songs")
      .select("*")
      .eq("id", data.songId)
      .maybeSingle();

    if (!song || song.user_id !== context.userId) {
      return { outcome: "not_found", recovered: false, message: "That track no longer exists." };
    }

    // Already playable — just finish the full-length file if it never landed.
    if (song.status === "completed" && song.sample_path) {
      if (!song.audio_path && song.suno_task_id) {
        const info = await fetchTask(String(song.suno_task_id));
        if (info.ok) await backfillFullAudio(admin, song, info.clips);
      }
      return { outcome: "completed", recovered: false, message: "This track is ready to play." };
    }

    if (!song.suno_task_id) {
      return {
        outcome: "no_task",
        recovered: false,
        message: "This track never reached the music engine.",
      };
    }

    const info = await fetchTask(String(song.suno_task_id));
    if (!info.ok) {
      return {
        outcome: "unavailable",
        recovered: false,
        message: "Couldn't reach the music engine just now. Try again in a moment.",
      };
    }

    const status = (info.status ?? "").toUpperCase();

    if (PENDING_STATES.includes(status) && info.clips.length === 0) {
      if (song.status === "failed") {
        await admin
          .from("songs")
          .update({
            status: "processing",
            error_message: null,
            failure_class: "retryable",
            next_retry_at: new Date(Date.now() + 3 * 60_000).toISOString(),
          })
          .eq("id", song.id);
      }
      return {
        outcome: "pending",
        recovered: false,
        message: "Still being made — give it another minute.",
      };
    }

    if (info.clips.length > 0) {
      const result = await materialiseClips(admin, song, info.clips);
      if (result.completed > 0 || result.parentCompleted) {
        return {
          outcome: "completed",
          recovered: true,
          takes: result.completed,
          message: "Recovered your finished track — it's in your library now.",
        };
      }
      if (result.skipped > 0) {
        return {
          outcome: "completed",
          recovered: false,
          message: "This track was already saved to your library.",
        };
      }
      await admin
        .from("songs")
        .update({
          status: "failed",
          error_message: "Retrying automatically while the music engine's file server recovers.",
          failure_class: "recoverable_cdn",
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq("id", song.id);
      return {
        outcome: "unavailable",
        recovered: false,
        message: "The music engine can't send the file yet. Try again in a few minutes.",
      };
    }

    await admin
      .from("songs")
      .update({
        status: "failed",
        error_message: status
          ? `The music engine reported: ${status.toLowerCase().replace(/_/g, " ")}.`
          : "The music engine didn't finish this track.",
        failure_class: "retryable",
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", song.id);

    return {
      outcome: "failed",
      recovered: false,
      message: "The music engine couldn't finish this one — tap retry to make it again.",
    };
  });
