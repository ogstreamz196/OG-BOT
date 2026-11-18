import { describe, expect, it } from "vitest";
import { isQuestion, maybeSportsGroupBanter, SPORTS_BANTER_ON } from "./sports-group.server";

describe("the Sports Guide group: quiet unless asked (the Boss, 2026-11-18)", () => {
  it("no random banter posts: the step is off and touches nothing", async () => {
    expect(SPORTS_BANTER_ON).toBe(false);
    const admin = {
      from: () => {
        throw new Error("should not read the database");
      },
    };
    expect(await maybeSportsGroupBanter(admin, Date.parse("2026-11-18T14:00:00Z"))).toBe("off");
  });

  it("answers questions only", () => {
    for (const q of [
      "which game is on tonight",
      "what's on today?",
      "any footy today",
      "Is the Arsenal game on?",
      "@OGBot who's playing",
      "fixtures?",
      "when is kick off",
    ])
      expect(isQuestion(q), q).toBe(true);
    for (const s of [
      "Arsenal are winning",
      "great game last night",
      "lol",
      "Man United vs Chelsea 8pm",
      "@OGBot you're rubbish",
      "",
    ])
      expect(isQuestion(s), s).toBe(false);
  });
});
