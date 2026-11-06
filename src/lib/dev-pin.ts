// dev.b055 sign-in (the Boss, 2026-11-06): the D.EV login is the same in every
// OGSTREAMZ app. Type `dev.b055` as the username and the 4-digit dev PIN as
// the password. The PIN lives only in the OGSTREAMZ hub's Vault (secret
// `dev_b055_pin`); the hub checks it and keeps one lockout for every app
// (supabase/hub/05_dev_pin.sql). Pure helpers here; the server side is
// dev-pin.functions.ts.

/** The usernames that sign in with the dev PIN. */
export const DEV_PIN_USERS = ["dev.b055"] as const;

/** The account dev.b055 signs in to on OG B0T: the Boss's own D.EV account. */
export const DEV_ACCOUNT_EMAIL = "ogstreamz196@gmail.com";

export function isDevPinUser(username: string | null | undefined): boolean {
  return (DEV_PIN_USERS as readonly string[]).includes((username ?? "").trim().toLowerCase());
}

/** What the hub's check says. */
export type DevPinCheck = { ok: boolean; code?: "wrong" | "locked" | "not_set"; message?: string };

/** The hub's answer, made safe to show (never trusts its shape). Pure. */
export function readDevPinCheck(body: unknown): DevPinCheck {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.ok === true) return { ok: true };
  const code = ["wrong", "locked", "not_set"].includes(String(b.code))
    ? (b.code as DevPinCheck["code"])
    : undefined;
  const message =
    typeof b.message === "string" && b.message.length < 200 ? b.message : "Wrong PIN.";
  return { ok: false, code, message };
}
