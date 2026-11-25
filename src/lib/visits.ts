// Counting visits so first-time members aren't buried in pop-ups (the Boss,
// 2026-11-24: "don't show too many pop ups when a user signs in… remove the
// immediate PRO pop up until the second visit"). A visit is a browser
// session: closing the tab or app and coming back starts the next one. Kept
// per member (or per device for things shown before sign-in) in
// localStorage; with storage blocked it counts as a first visit, so nothing
// pops up.

type Store = Pick<Storage, "getItem" | "setItem">;

const countKey = (who: string) => `og_visits_${who}`;
const sessionKey = (who: string) => `og_visit_counted_${who}`;

/** This visit's number for `who` (1 = first), counting it once per session. */
export function countVisit(who: string, local: Store | null, session: Store | null): number {
  try {
    if (!local || !session) return 1;
    const seen = Math.max(0, Number(local.getItem(countKey(who))) || 0);
    if (session.getItem(sessionKey(who))) return Math.max(1, seen);
    const n = seen + 1;
    local.setItem(countKey(who), String(n));
    session.setItem(sessionKey(who), "1");
    return n;
  } catch {
    return 1;
  }
}

/** The browser's stores, or null where they can't be used. */
export function browserStores(): { local: Store | null; session: Store | null } {
  try {
    if (typeof window === "undefined") return { local: null, session: null };
    return { local: window.localStorage, session: window.sessionStorage };
  } catch {
    return { local: null, session: null };
  }
}
