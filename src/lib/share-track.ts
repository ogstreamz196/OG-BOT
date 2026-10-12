import { toast } from "sonner";
const SITE_URL = "https://ogbot.co.uk";
const SHARE_LOGO_URL = "/share/og-bot-track.png";

function trackShareUrl(songId?: string) {
  return songId ? `${SITE_URL}/track/${encodeURIComponent(songId)}` : SITE_URL;
}

async function fetchLogoFile(): Promise<File | null> {
  try {
    const response = await fetch(SHARE_LOGO_URL);
    if (!response.ok) return null;
    const logo = await response.blob();
    return new File([logo], "og-bot.png", { type: logo.type || "image/png" });
  } catch {
    return null;
  }
}

/**
 * Open the device share sheet for a finished track.
 *
 * Preference order:
 *  1. Share the actual audio file (WhatsApp / Messages / AirDrop receive the MP3)
 *  2. Share a link (site link — signed audio URLs expire)
 *  3. Copy the link to the clipboard as a last resort
 */
export async function shareTrack({
  title,
  blob,
  filename,
  songId,
  url = trackShareUrl(songId),
}: {
  title: string;
  blob?: Blob | null;
  filename: string;
  songId?: string;
  url?: string;
}): Promise<void> {
  const text = `🎧 “${title}” — made with OG BOT\nListen here: ${url}`;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const logoFile = await fetchLogoFile();

  // Inside the phone app the web share sheet can't send files, so share the MP3
  // the native layer already downloaded (or write the bytes we have).
  let isNative = false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    isNative = Capacitor.isNativePlatform();
    if (isNative && Capacitor.isPluginAvailable("Share")) {
      const [{ Filesystem, Directory }, { Share }, { nativeSavedFiles, safeFileName }] =
        await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
          import("@/lib/download-file"),
        ]);
      let uri = nativeSavedFiles.get(filename);
      if (!uri && blob) {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        const saved = await Filesystem.writeFile({
          path: safeFileName(filename),
          data,
          directory: Directory.Cache,
        });
        uri = saved.uri;
      }
      if (uri) {
        const files = [uri];
        if (logoFile) {
          const logoData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(logoFile);
          });
          const savedLogo = await Filesystem.writeFile({
            path: "og-bot-share-logo.png",
            data: logoData,
            directory: Directory.Cache,
          });
          files.push(savedLogo.uri);
        }
        await Share.share({ title, text, url, files, dialogTitle: "Share your track" });
        return;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return;
    console.warn("[shareTrack] native share failed", e);
  }
  if (isNative) {
    toast.error("Couldn't save the track — check your connection and try again");
    return;
  }

  // Browsers only open the share sheet straight after a tap. Preparing the MP3
  // takes a moment, so if the tap has "expired" we offer a one-tap Share button.
  const openSheet = async (): Promise<boolean> => {
    if (!nav?.share) return false;
    const file = blob ? new File([blob], filename, { type: blob.type || "audio/mpeg" }) : null;
    const canFiles = (files: File[]) =>
      typeof nav.canShare === "function" && nav.canShare({ files });
    if (file && logoFile && canFiles([file, logoFile])) {
      await nav.share({ files: [file, logoFile], title, text, url });
    } else if (file && canFiles([file])) {
      await nav.share({ files: [file], title, text, url });
    } else {
      await nav.share({ title, text, url });
    }
    return true;
  };

  try {
    if (await openSheet()) return;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      toast("Your track is ready to share", {
        duration: 15000,
        action: {
          label: "Share",
          onClick: () => {
            void openSheet().catch((err) => {
              if (err instanceof DOMException && err.name === "AbortError") return;
              void navigator.clipboard
                .writeText(`${text} ${url}`)
                .then(() => toast.success("Share link copied — paste it anywhere"));
            });
          },
        },
      });
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast.success("Share link copied — paste it anywhere");
  } catch {
    toast("Sharing isn't supported on this device");
  }
}
