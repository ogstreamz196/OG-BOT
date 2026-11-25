// Google and Apple sign-in come back to the site's plain address (the sign-in
// broker only returns there; a path broke Apple and Google sign-in on
// 2026-11-25). So the sign-in button leaves a note for this tab, and the home
// page sends the member on to the Music hub once, as the Boss asked
// (2026-11-24: "show them the Music hub page straight away").

const KEY = "og_after_sign_in";

/** Called just before leaving for Google/Apple. Never throws. */
export function markSignInLanding(): void {
  try {
    sessionStorage.setItem(KEY, "/library");
  } catch {
    /* storage blocked: they land on home, which is fine */
  }
}

/** Where to go after a fresh sign-in (once), or null. Never throws. */
export function takeSignInLanding(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const to = sessionStorage.getItem(KEY);
    if (!to) return null;
    sessionStorage.removeItem(KEY);
    return to === "/library" ? to : null;
  } catch {
    return null;
  }
}
