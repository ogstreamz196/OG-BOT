import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useSharedChannel } from "@/lib/shared-realtime";

export type SongChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

/**
 * Changes to the signed-in member's songs. One channel for the whole page:
 * the track-ready toast, device notifications, Drive archiving, recent songs
 * and the library all listen to the same feed (each used to open its own,
 * and `songs` events carry whole rows, lyrics included).
 */
export function useUserSongsRealtime(
  uid: string | null | undefined,
  listener: (change: SongChange) => void,
): void {
  useSharedChannel<SongChange>(
    uid ? `songs:${uid}` : null,
    (ch, emit) =>
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "songs", filter: `user_id=eq.${uid}` },
        emit,
      ),
    listener,
  );
}
