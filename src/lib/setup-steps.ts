// The one setup reminder in the header (the Boss, 2026-11-24: no checklist
// pop-up; a reminder in the header for Telegram, replaced by the email ask
// once it's done, each staying until it's done, then the header stays clear).

export type SetupStep = "username" | "telegram" | "email";

/** The step to remind about now, or null when everything's done. Pure. */
export function nextSetupStep(done: {
  username: boolean;
  telegram: boolean;
  email: boolean;
}): SetupStep | null {
  // Google/Apple sign-ins need a username before anything else works well.
  if (!done.username) return "username";
  if (!done.telegram) return "telegram";
  if (!done.email) return "email";
  return null;
}

/** Whether the account's email is a real one (not the username placeholder). Pure. */
export function hasRealEmail(email: string | null | undefined): boolean {
  return !!email && !email.toLowerCase().endsWith("@ogstreamz.app");
}
