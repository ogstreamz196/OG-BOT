import { describe, expect, it } from "vitest";
import { foulAllowed, freeAccessOn } from "./foul-access.server";

const NOW = Date.parse("2026-11-23T12:00:00Z");

describe("foulAllowed (one rule for the website chat and Telegram)", () => {
  it("PRO, the Boss and developers always get it", () => {
    for (const role of ["vip", "admin", "boss", "dev"])
      expect(foulAllowed([role], null, false, NOW), role).toBe(true);
  });
  it("free members only on the trial or while free access is on", () => {
    expect(foulAllowed(["user"], null, false, NOW)).toBe(false);
    expect(foulAllowed([], "2026-11-30T00:00:00Z", false, NOW)).toBe(true);
    expect(foulAllowed([], "2026-11-01T00:00:00Z", false, NOW)).toBe(false);
    expect(foulAllowed([], null, true, NOW)).toBe(true);
  });
  it("free access respects its end time", () => {
    expect(freeAccessOn([{ key: "free_access_all", value: true }], NOW)).toBe(true);
    expect(
      freeAccessOn(
        [
          { key: "free_access_all", value: true },
          { key: "free_access_expires_at", value: "2026-11-20T00:00:00Z" },
        ],
        NOW,
      ),
    ).toBe(false);
  });
});
