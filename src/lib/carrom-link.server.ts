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

export type CarromPass = { userId: string; name: string };

export async function signCarromPass(pass: CarromPass, now = Date.now()): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        u: pass.userId,
        n: pass.name.slice(0, 60),
        e: Math.floor(now / 1000) + TTL_SECONDS,
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
    };
    if (typeof p.u !== "string" || typeof p.e !== "number") return null;
    if (p.e * 1000 < now) return null;
    return { userId: p.u, name: typeof p.n === "string" ? p.n : "" };
  } catch {
    return null;
  }
}
