/**
 * Links to a full song that live on the Boss's Google Drive (where full songs
 * are kept: see drive-archive.functions.ts). A link is a signed, expiring
 * ticket for one song, checked by /api/public/song-audio, which streams the
 * file from Drive. Whoever hands out a link has already checked the person
 * may play the full song (song-url, the public track page, Telegram), so the
 * ticket only proves "OG B0T issued this, for this song, until then".
 *
 * Signed with a key derived from the service role key, which the site and
 * the database functions both have; supabase/functions/_shared/song-audio-link.ts
 * is the same code for the song-url function. Keep the two in step
 * (song-audio-link.test.ts checks they agree).
 */

export const SONG_AUDIO_PATH = "/api/public/song-audio";

export type SongAudioTicket = {
  /** Song id. */
  s: string;
  /** Expiry, seconds since 1970. */
  e: number;
  /** Ask the browser to save it under this name, when set. */
  d?: string;
};

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`og-song-audio:${secret}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** A signed ticket for one song, good for `ttlSeconds`. */
export async function signSongTicket(secret: string, ticket: SongAudioTicket): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(ticket)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)),
  );
  return `${body}.${b64url(sig)}`;
}

/** The ticket, if it's genuine and not expired; else null. */
export async function readSongTicket(
  secret: string,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SongAudioTicket | null> {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(body),
    );
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SongAudioTicket;
    if (typeof t.s !== "string" || typeof t.e !== "number" || t.e < nowSeconds) return null;
    return t;
  } catch {
    return null;
  }
}

/** The full URL for a song's Drive stream, good for `ttlSeconds`. */
export async function songAudioUrl(
  secret: string,
  base: string,
  songId: string,
  ttlSeconds: number,
  downloadName?: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const t = await signSongTicket(secret, {
    s: songId,
    e: nowSeconds + ttlSeconds,
    ...(downloadName ? { d: downloadName } : {}),
  });
  return `${base.replace(/\/$/, "")}${SONG_AUDIO_PATH}?t=${t}`;
}
