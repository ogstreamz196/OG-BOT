/**
 * Force a real file download instead of letting the browser navigate to (and
 * play) the signed URL in a new tab.
 *
 * Inside the phone app the WebView ignores `<a download>` and blob links, so we
 * let the native layer download the MP3 straight to the phone (Documents) and
 * keep a cached copy for the share sheet. On the web we fetch the bytes and hand
 * the browser a same-origin blob.
 *
 * Returns the downloaded bytes when available so callers can hand the same
 * file straight to the share sheet.
 */

/** Native file URIs saved this session, keyed by the requested filename. */
export const nativeSavedFiles = new Map<string, string>();

export function safeFileName(filename: string) {
  const name = filename.replace(/[^\w.\- ]+/g, "_").trim() || "og-track.mp3";
  return name.toLowerCase().endsWith(".mp3") ? name : `${name}.mp3`;
}

async function nativeDownload(url: string, filename: string): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Filesystem")) return false;
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const name = safeFileName(filename);

    // Cached copy for sharing (always writable, no permissions needed).
    const cached = await Filesystem.downloadFile({
      url,
      path: name,
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
    void cached;
    nativeSavedFiles.set(filename, uri);

    // Best-effort permanent copy on the phone.
    try {
      await Filesystem.copy({
        from: name,
        directory: Directory.Cache,
        to: `OG B0T/${name}`,
        toDirectory: Directory.Documents,
      });
    } catch {
      /* the share sheet still lets the user save it */
    }
    return true;
  } catch (e) {
    console.warn("[downloadFile] native download failed", e);
    return false;
  }
}

export async function downloadFile(url: string, filename: string): Promise<Blob | null> {
  if (await nativeDownload(url, filename)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchor(objectUrl, filename);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return blob;
  } catch {
    triggerAnchor(url, filename);
    return null;
  }
}

function triggerAnchor(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
