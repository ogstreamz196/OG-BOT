// A short-lived pass that lets carrom.ogbot.co.uk set up (or find) the
// member's OG Carrom account. OG BOT signs it with a key only this server
// has; carrom can't check the signature itself, so it asks
// /api/public/carrom/verify. The pass carries only the account id and the
// display name, never an email, and coins aren't shared.

const TTL_SECONDS = 5 * 60;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(data: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Server key missing");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`carrom-link:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

/**
 * `challenge` is set only for the OG CARROM phone app: the hash of a secret
 * the app keeps to itself, so a pass caught on its way back to the app is
 * useless to anyone else.
 */
export type CarromPass = { userId: string; name: string; challenge?: string };

/** A base64url SHA-256 hash, as the app sends it. */
export const isChallenge = (c: unknown): c is string =>
  typeof c === "string" && /^[A-Za-z0-9_-]{43}$/.test(c);

export async function signCarromPass(pass: CarromPass, now = Date.now()): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        u: pass.userId,
        n: pass.name.slice(0, 60),
        e: Math.floor(now / 1000) + TTL_SECONDS,
        ...(pass.challenge ? { c: pass.challenge } : {}),
      }),
    ),
  );
  return `${payload}.${await hmac(payload)}`;
}

/** The pass's contents if it's genuine and not expired, else null. */
export async function verifyCarromPass(
  token: string,
  now = Date.now(),
): Promise<CarromPass | null> {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  // Constant-time compare.
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      u?: unknown;
      n?: unknown;
      e?: unknown;
      c?: unknown;
    };
    if (typeof p.u !== "string" || typeof p.e !== "number") return null;
    if (p.e * 1000 < now) return null;
    return {
      userId: p.u,
      name: typeof p.n === "string" ? p.n : "",
      ...(isChallenge(p.c) ? { challenge: p.c } : {}),
    };
  } catch {
    return null;
  }
}

/* ── Guest passes ──────────────────────────────────────────────────────── */
// A guest (not signed in to OG B0T) who opens OG CARROM from the landing page
// gets a guest pass. When they pick a carrom username, carrom's server sends
// it back to /api/public/carrom/register-guest, which makes them an OG B0T
// account with that name. One pass makes one account (the id is recorded).

const GUEST_TTL_SECONDS = 24 * 60 * 60;

export type CarromGuestPass = { guestId: string };

export async function signCarromGuestPass(now = Date.now()): Promise<string> {
  const guestId = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ t: "guest", g: guestId, e: Math.floor(now / 1000) + GUEST_TTL_SECONDS }),
    ),
  );
  return `${payload}.${await hmac(payload)}`;
}

/** The guest pass's id if it's genuine and not expired, else null. */
export async function verifyCarromGuestPass(
  token: string,
  now = Date.now(),
): Promise<CarromGuestPass | null> {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      t?: unknown;
      g?: unknown;
      e?: unknown;
    };
    if (p.t !== "guest" || typeof p.g !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p.g)) return null;
    if (typeof p.e !== "number" || p.e * 1000 < now) return null;
    return { guestId: p.g };
  } catch {
    return null;
  }
}

/** Carrom usernames: 3–16 letters, numbers or underscores (carrom's own rule). */
export const isCarromUsername = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_]{3,16}$/.test(v);

/**
 * OG B0T names to try for a carrom username: the name itself first, then
 * numbered versions if an OG B0T member already has it.
 */
export function* guestNameCandidates(username: string): Generator<string> {
  yield username;
  for (let n = 2; n < 50; n++) yield `${username.slice(0, 16 - String(n).length - 1)}_${n}`;
}
