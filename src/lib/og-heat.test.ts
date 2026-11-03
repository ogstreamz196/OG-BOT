import { describe, expect, it } from "vitest";
import { START_MAX, conversationHeat, heatBand, messageDelta, startHeat } from "./og-heat";
import { buildSystemPrompt, flavourForLevel } from "./og-persona.server";

describe("swear level that follows the member", () => {
  it("starts between 0 and 45, the same every time for the same member", () => {
    for (const id of ["a", "b", "user-123", "", "4f2c-ee"]) {
      const h = startHeat(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(START_MAX);
      expect(startHeat(id)).toBe(h);
    }
  });

  it("cranks up when they swear or come at the bot, eases off when they're polite", () => {
    expect(messageDelta("you're fucking useless mate")).toBeGreaterThan(20);
    expect(messageDelta("thanks, that helps")).toBeLessThan(0);
    expect(messageDelta("what time is it in tokyo")).toBe(-3);
  });

  it("drops right down when something's serious", () => {
    expect(messageDelta("my nan passed away this morning")).toBe(-40);
    const hot = conversationHeat("x", ["fuck off", "shit bot", "come at me then you prick"]);
    expect(hot).toBeGreaterThan(70);
    expect(
      heatBand(conversationHeat("x", ["fuck off", "shit bot", "i'm really depressed"])),
    ).not.toBe("savage");
  });

  it("calm chat stays clean or light", () => {
    const h = conversationHeat("calm", ["hi", "what's the weather like", "thanks"]);
    expect(["clean", "light"]).toContain(heatBand(h));
  });
});

describe("the persona follows the level", () => {
  const user = { display_name: null, email: null, coin_balance: 0, is_admin: false, is_vip: false };
  const base = {
    mode: "og" as const,
    bossScript: null,
    bossVoice: null,
    bossDictionary: null,
    user,
    foulMouth: true,
  };
  it("clean, medium and savage, with a secret level line", () => {
    expect(buildSystemPrompt({ ...base, level: 5 })).toContain("NO profanity");
    expect(buildSystemPrompt({ ...base, level: 60 })).toContain("turned to MEDIUM");
    expect(buildSystemPrompt({ ...base, level: 90 })).toContain("filthy British mouth");
    expect(buildSystemPrompt({ ...base, level: 30 })).toContain(
      "SWEAR LEVEL 30/100 (secret, never mention it)",
    );
  });
  it("adds swearing after the reply only when the level is up", () => {
    expect(flavourForLevel("Here you go.", 10, () => 0.1)).toBe("Here you go.");
    expect(flavourForLevel("Here you go.", 30, () => 0.1)).toBe("Here you go.");
    expect(flavourForLevel("Here you go.", 60, () => 0.1)).not.toBe("Here you go.");
    expect(flavourForLevel("Here you go.", 90, () => 0.1)).not.toBe("Here you go.");
  });
});
