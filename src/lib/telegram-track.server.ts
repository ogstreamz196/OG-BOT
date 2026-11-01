// Sends a member's unlocked track to their own Telegram chat as an MP3, from
// the "Send to Telegram" button in the app. Same rule as downloading the full
// track (song-url "full"/"download"): an unlocked_songs row for this member,
// or Boss/admin. Only ever to the chat linked to the member's own account.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type TrackToTelegram =
  | "sent"
  | "not_linked"
  | "not_found"
  | "locked"
  | "not_ready"
  | "too_soon"
  | "failed";

// One send per member per track every 30 seconds, so a double tap doesn't
// post the song twice. Per instance only; it's a nicety, not a limit.
const recent = new Map<string, number>();
const GAP_MS = 30_000;

export async function sendTrackToTelegram(
  admin: Admin,
  userId: string,
  songId: string,
): Promise<TrackToTelegram> {
  const [{ data: profile }, { data: song }, { data: unlock }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("telegram_chat_id").eq("id", userId).maybeSingle(),
    admin
      .from("songs")
      .select("id, user_id, title, audio_path, drive_audio_id, status")
      .eq("id", songId)
      .maybeSingle(),
    admin
      .from("unlocked_songs")
      .select("id")
      .eq("user_id", userId)
      .eq("song_id", songId)
      .maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId).in("role", ["boss", "admin"]),
  ]);
  const chatId = profile?.telegram_chat_id;
  if (!chatId) return "not_linked";
  if (!song || song.status !== "completed") return "not_found";
  if (!unlock && !roles?.length) return "locked";
  if (!song.audio_path) return "not_ready";

  const key = `${userId}:${songId}`;
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < GAP_MS) return "too_soon";
  recent.set(key, Date.now());
  if (recent.size > 500)
    for (const [k, at] of recent) if (Date.now() - at > GAP_MS) recent.delete(k);

  // Telegram fetches the file itself from this short-lived link (from the
  // Boss's Drive when the song is kept there).
  const { fullSongUrl } = await import("@/lib/song-audio.server");
  const audioUrl = await fullSongUrl(admin, song, 600);
  if (!audioUrl) {
    recent.delete(key);
    return "failed";
  }
  const { telegramApi, escapeTelegramHtml: esc } = await import("@/lib/telegram-api.server");
  const title = song.title || "OG B0T track";
  const sent = await telegramApi("sendAudio", {
    chat_id: chatId,
    audio: audioUrl,
    title,
    performer: "OG B0T",
    caption: `🎧 <b>${esc(title)}</b>\nFresh from the OG B0T studio. Bang it out loud, you legend.`,
    parse_mode: "HTML",
  });
  if (!sent?.ok) {
    recent.delete(key);
    return "failed";
  }
  return "sent";
}
