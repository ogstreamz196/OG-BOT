import { toast } from "sonner";
const SITE_URL = "https://ogbot.co.uk";

export function trackShareUrl(songId?: string) {
  return songId ? `${SITE_URL}/track/${encodeURIComponent(songId)}` : SITE_URL;
}

/** Share message text (without the link — the share sheet adds it once). */
export function trackShareText(title: string) {
  return `Listen to “${title}” on 0G B0T 🎧`;
}

/** Clipboard version: message plus the link exactly once, on its own line. */
export function trackShareClipboard(title: string, url: string) {
  return `${trackShareText(title)}\n${url}`;
}

/**
 * Share links only open public tracks, so sharing your own private track
 * makes it public. Only the owner's update goes through (row security).
 */
async function makeShareable(songId: string): Promise<boolean> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase
      .from("songs")
      .update({ is_public: true } as never)
      .eq("id", songId)
      .eq("is_public", false)
      .eq("status", "completed")
      .select("id");
    return !!data?.length;
  } catch {
    return false;
  }
}

/**
 * Open the device share sheet with a link to the track. Never downloads or
 * attaches the audio file — the link streams it.
 */
export async function shareTrack({
  title,
  songId,
  url = trackShareUrl(songId),
}: {
  title: string;
  /** Ignored: sharing is link-only. Kept so old callers still compile. */
  blob?: Blob | null;
  filename?: string;
  songId?: string;
  url?: string;
}): Promise<void> {
  const text = trackShareText(title);
  if (songId) {
    void makeShareable(songId).then((changed) => {
      if (changed) toast("Your track is now public, so the link works for everyone");
    });
  }

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Share")) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, url, dialogTitle: "Share your track" });
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return;
    console.warn("[shareTrack] native share failed", e);
  }

  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share({ title, text, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(trackShareClipboard(title, url));
    toast.success("Share link copied — paste it anywhere");
  } catch {
    toast("Sharing isn't supported on this device");
  }
}
