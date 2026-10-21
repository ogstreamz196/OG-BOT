import type { RealtimeChannel } from "@supabase/supabase-js";

/** A user_preferences change as Supabase realtime delivers it. */
export type UserPrefsPayload = { new?: Record<string, unknown>; old?: Record<string, unknown> };

/**
 * The member's user_preferences row, one shared channel for useFoulMouth,
 * useMessengerMode and useDisplayPrefs (each reads its own columns from the
 * same event).
 */
export const userPrefsChannel = {
  key: (uid: string | null) => (uid ? `user-prefs:${uid}` : null),
  bind:
    (uid: string | null) =>
    (ch: RealtimeChannel, emit: (payload: unknown) => void): RealtimeChannel =>
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_preferences", filter: `user_id=eq.${uid}` },
        emit,
      ),
};
