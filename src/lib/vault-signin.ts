/** OG VAULT → OG B0T sign-in check: pure helpers (signature, freshness, username). */
import { createHmac, timingSafeEqual } from "crypto";

export const VAULT_MAX_SKEW_MS = 2 * 60_000;
export const VAULT_USERNAME_DOMAIN = "ogstreamz.app";

export function vaultSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function vaultSignatureOk(secret: string, rawBody: string, sig: string | null): boolean {
  if (!secret || !sig) return false;
  const want = Buffer.from(vaultSignature(secret, rawBody));
  const got = Buffer.from(sig.trim().toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export function vaultFresh(ts: number, now = Date.now()): boolean {
  return Number.isFinite(ts) && Math.abs(now - ts) <= VAULT_MAX_SKEW_MS;
}

/** Same rule the website uses for username logins. */
export function vaultLoginEmail(username: string): string {
  const h = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${h}@${VAULT_USERNAME_DOMAIN}`;
}
