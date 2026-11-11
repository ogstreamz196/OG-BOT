import { describe, expect, test } from "vitest";
import {
  bondDelta,
  bondNote,
  bondTier,
  fadedScore,
  goesAfter,
  readBondSignal,
  roomNote,
} from "./og-bond";

describe("readBondSignal", () => {
  test("compliments to OG B0T", () => {
    for (const t of [
      "you're a legend",
      "og bot you are the goat",
      "love you og",
      "that was cold 😂",
      "you're a legend, you muppet",
      "respect bro",
      "❤️",
    ]) {
      expect(readBondSignal(t), t).toBe("compliment");
    }
  });

  test("thanks and laughing", () => {
    for (const t of ["thanks man", "cheers", "lmao", "😂😂"]) {
      expect(readBondSignal(t), t).toBe("thanks");
    }
  });

  test("abuse aimed at OG B0T, including a negated compliment", () => {
    for (const t of [
      "you're useless",
      "shut up",
      "fuck off",
      "you're not funny",
      "you are not the best",
      "trash bot",
    ]) {
      expect(readBondSignal(t), t).toBe("insult");
    }
  });

  test("talking about someone else isn't an insult at OG B0T", () => {
    for (const t of ["my boss is an idiot", "what's the weather like", "gold signal please"]) {
      expect(readBondSignal(t), t).toBe("chat");
    }
  });
});

describe("scores", () => {
  test("tiers", () => {
    expect(bondTier(60)).toBe("ride_or_die");
    expect(bondTier(20)).toBe("mate");
    expect(bondTier(0)).toBe("neutral");
    expect(bondTier(-20)).toBe("thin_ice");
    expect(bondTier(-80)).toBe("enemy");
  });

  test("battle insults only sting a little", () => {
    expect(bondDelta("insult")).toBe(-4);
    expect(bondDelta("insult", true)).toBe(-1);
    expect(bondDelta("compliment", true)).toBe(6);
  });

  test("fades halfway to neutral in 45 days", () => {
    const now = Date.parse("2026-10-30T00:00:00Z");
    const then = new Date(now - 45 * 86_400_000);
    expect(fadedScore(80, then, now)).toBeCloseTo(40);
    expect(fadedScore(-40, then, now)).toBeCloseTo(-20);
  });
});

describe("prompt notes", () => {
  test("friends are never insulted, and nothing mentions a score", () => {
    const note = bondNote(50, "chat", 50, "Dave");
    expect(note).toMatch(/NEVER insult them/);
    expect(note).toMatch(/Never mention points, scores/);
    expect(note).not.toMatch(/\b50\b/);
  });

  test("neutral chat adds nothing; a compliment is taken with swagger", () => {
    expect(bondNote(0, "chat")).toBe("");
    expect(bondNote(3, "compliment", 0)).toMatch(/Take it like a legend/);
    expect(bondNote(-50, "compliment", -55)).toMatch(/don't trust it/);
  });

  test("becoming friends gets a one-off moment", () => {
    expect(bondNote(16, "compliment", 12)).toMatch(/grown on you/);
    expect(bondNote(-16, "insult", -12)).toMatch(/last straw/);
  });

  test("room note lists friends to defend and enemies", () => {
    const note = roomNote([
      { name: "Dave", score: 30 },
      { name: "Sam", score: 0 },
      { name: "Kev", score: -50 },
    ]);
    expect(note).toMatch(/Your friends here: Dave\./);
    expect(note).toMatch(/can't stand: Kev\./);
    expect(note).not.toMatch(/Sam/);
    expect(roomNote([{ name: "Sam", score: 2 }])).toBe("");
  });
});

describe("goesAfter", () => {
  test("asking to roast or insulting a friend by name", () => {
    expect(goesAfter("roast @dave", ["Dave"])).toBe("Dave");
    expect(goesAfter("dave is a muppet", ["Dave"])).toBe("Dave");
    expect(goesAfter("dave is sound", ["Dave"])).toBeNull();
    expect(goesAfter("roast davey", ["Dave"])).toBeNull();
  });
});
