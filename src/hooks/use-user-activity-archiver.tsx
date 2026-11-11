import { useUserSongsRealtime } from "@/hooks/user-songs-realtime";
import { useAuth } from "@/hooks/use-auth";

/**
 * Subscribes to the signed-in user's `songs` rows. When a song flips to a
 * final/completed status (and is NOT a preview/variation), archives the MP3
 * to Drive. Fire-and-forget; failures
 * are logged but never block the UI.
 */
export function UserActivityArchiver() {
  const { user } = useAuth();

  useUserSongsRealtime(user?.id, async (payload) => {
    if (payload.eventType !== "UPDATE") return;
    const row = payload.new as {
      id: string;
      status?: string | null;
      is_variation?: boolean | null;
      audio_path?: string | null;
    };
    const prev = payload.old as { status?: string | null };
    const becameFinal =
      (row.status === "complete" || row.status === "completed") && prev?.status !== row.status;
    if (!becameFinal) return;
    if (row.is_variation) return; // previews skipped
    if (!row.audio_path) return;
    try {
      const drive = await import("@/lib/drive-archive.functions");
      await drive.archiveSongToDrive({ data: { songId: row.id } });
    } catch (e) {
      console.error("song archive failed", e);
    }
  });

  return null;
}
