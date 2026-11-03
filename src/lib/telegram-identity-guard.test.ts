import { describe, it, expect } from "vitest";
import { isIdentitySnoop, pickSnoopCusses, mentionHtml } from "./telegram-identity-guard";

describe("identity guard", () => {
  it("flags identity asks", () => {
    for (const t of ["who is @dave", "what's his real name", "who's behind this account", "dox him", "where does @sam live"])
      expect(isIdentitySnoop(t)).toBe(true);
  });
  it("ignores normal chat", () => {
    for (const t of ["who is winning tonight", "signal btc", "cuss me", "who wants gold"])
      expect(isIdentitySnoop(t)).toBe(false);
  });
  it("picks 3 different cusses", () => {
    const c = pickSnoopCusses(3);
    expect(new Set(c).size).toBe(3);
  });
  it("tags by username or link", () => {
    expect(mentionHtml({ username: "bob" })).toBe("@bob");
    expect(mentionHtml({ id: 5, first_name: "Al" })).toContain("tg://user?id=5");
  });
});
