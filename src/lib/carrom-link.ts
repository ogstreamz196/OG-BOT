/**
 * Signed hand-off from OG Bot (ogbot.co.uk) to OG CARROM.
 *
 * OG Bot signs a short-lived token for a signed-in user; the carrom server checks
 * it, so carrom never sees an OG Bot password or session. The token carries only
 * the OG Bot user id and a display name. Format: `base64url(payload).base64url(hmac)`.
 * This file is copied from the OG CARROM repo (src/lib/carrom/ogLink.ts); keep them in step.
 */

export const LINK_AUDIENCE = "og-carrom";
/** How long a token may be used after OG Bot issues it. */
export const LINK_TTL_SECONDS = 120;

export interface LinkClaims {
  /** OG Bot user id (uuid). */
  sub: string;
  /** OG Bot display name (only a suggestion for the carrom username). */
  name: string;
  /** Unique id; each token can be used once. */
  jti: string;
  /** Expiry, unix seconds. */
  exp: number;
  aud: typeof LINK_AUDIENCE;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signLinkToken(claims: LinkClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(mac))}`;
}

/** Returns the claims, or null for anything forged, malformed, expired or for another app. */
export async function verifyLinkToken(
  token: unknown,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<LinkClaims | null> {
  if (typeof token !== "string" || token.length > 2000 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const mac = unb64url(parts[1]);
  if (!mac) return null;
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    mac,
    enc.encode(parts[0]),
  );
  if (!ok) return null;
  const raw = unb64url(parts[0]);
  if (!raw) return null;
  let c: Partial<LinkClaims>;
  try {
    c = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (c.aud !== LINK_AUDIENCE) return null;
  if (typeof c.sub !== "string" || !UUID.test(c.sub)) return null;
  if (typeof c.jti !== "string" || c.jti.length < 8 || c.jti.length > 64) return null;
  if (typeof c.exp !== "number" || !Number.isFinite(c.exp)) return null;
  // Also reject tokens issued with an unreasonably long life.
  if (c.exp < nowSeconds || c.exp > nowSeconds + LINK_TTL_SECONDS * 2) return null;
  return {
    sub: c.sub.toLowerCase(),
    name: typeof c.name === "string" ? c.name.slice(0, 64) : "",
    jti: c.jti,
    exp: c.exp,
    aud: LINK_AUDIENCE,
  };
}

/** Turn an OG Bot display name into something that passes the carrom username rules. */
export function suggestUsername(name: string, taken: number): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]+/g, "")
    .slice(0, 12);
  const start = base.length >= 3 ? base : "Player";
  return taken === 0 ? start : `${start}${taken + 1}`.slice(0, 16);
}
