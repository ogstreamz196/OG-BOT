import { describe, expect, it } from "vitest";
import { countVisit } from "./visits";
import { hasRealEmail, nextSetupStep } from "./setup-steps";

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("a calm sign-in", () => {
  it("counts visits once per browser session, per member", () => {
    const local = store();
    let session = store();
    expect(countVisit("u1", local, session)).toBe(1);
    // Same session (page changes, refreshes): still the first visit.
    expect(countVisit("u1", local, session)).toBe(1);
    // Closed and came back: the second visit.
    session = store();
    expect(countVisit("u1", local, session)).toBe(2);
    expect(countVisit("u2", local, session)).toBe(1);
    // No storage at all: treated as a first visit, so nothing pops up.
    expect(countVisit("u1", null, null)).toBe(1);
  });

  it("one header reminder at a time: Telegram, then email, then nothing", () => {
    expect(nextSetupStep({ username: true, telegram: false, email: false })).toBe("telegram");
    expect(nextSetupStep({ username: true, telegram: true, email: false })).toBe("email");
    expect(nextSetupStep({ username: true, telegram: true, email: true })).toBeNull();
    expect(nextSetupStep({ username: false, telegram: false, email: false })).toBe("username");
    expect(hasRealEmail("abc123@ogstreamz.app")).toBe(false);
    expect(hasRealEmail("me@gmail.com")).toBe(true);
  });
});
