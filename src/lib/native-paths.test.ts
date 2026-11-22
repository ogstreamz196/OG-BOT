import { describe, expect, it } from "vitest";
import { NATIVE_HIDDEN_PATHS, pathAllowed, storeItemAllowed } from "./native-policy";

describe("website-only pages stay out of the phone apps", () => {
  it("signals, the OG SIGNAL BOT and the Signals Control Room are hidden in the apps only", () => {
    for (const p of ["/signals", "/copier", "/admin/signals"]) {
      expect(NATIVE_HIDDEN_PATHS).toContain(p);
      expect(pathAllowed(p, true)).toBe(false);
      expect(pathAllowed(p, false)).toBe(true);
    }
    expect(pathAllowed("/admin/users", true)).toBe(true);
    expect(pathAllowed(undefined, true)).toBe(true);
    expect(storeItemAllowed("og-signal-bot-token", true)).toBe(false);
  });
});
