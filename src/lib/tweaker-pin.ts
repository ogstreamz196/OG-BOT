// A PIN lock for the TradeTweaker signal control room (the Boss, 2026-11-07).
// It's a second lock on top of the admin gate: the room sends signals and holds
// the learning data, so it can be pinned shut. The PIN is never stored in the
// clear — only a salted SHA-256 hash lives in app_settings (key below), set by
// the Boss. Pure helpers here; the hashing and storage are server-side in
// tweaker-pin.functions.ts.

export const TWEAKER_PIN_KEY = "signals_tweaker_pin";
/** Shortest PIN allowed. The Boss can make it longer; digits only. */
export const PIN_MIN = 4;
/** Per-browser flag that this session has already unlocked the room. */
export const TWEAKER_UNLOCK_FLAG = "og-tweaker-unlocked";

/** Digits only, capped, so a PIN is always clean before it's sent or hashed. */
export function cleanPin(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(0, 12);
}

/** A reason the PIN can't be set, or null when it's fine. */
export function pinError(s: string | null | undefined): string | null {
  const p = cleanPin(s);
  if (p.length < PIN_MIN) return `PIN must be at least ${PIN_MIN} digits.`;
  return null;
}

/** Split a stored "salt:hash" value, or null when nothing is set. */
export function parseStoredPin(
  v: string | null | undefined,
): { salt: string; hash: string } | null {
  if (typeof v !== "string" || !v.includes(":")) return null;
  const [salt, hash] = v.split(":");
  return salt && hash ? { salt, hash } : null;
}
