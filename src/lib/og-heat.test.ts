import { describe, expect, it } from "vitest";
import { FIRST_CUSS, SECOND_CUSS, conversationHeat, heatBand, isCuss } from "./og-heat";
import { buildSystemPrompt, flavourForLevel } from "./og-persona.server";

describe("swear level that follows the member", () => {
  it("starts at 0 and stays clean while they're friendly", () => {
    expect(conversationHeat("a", [])).toBe(0);
    expect(heatBand(conversationHeat("a", ["hi", "what's the weather like", "thanks"]))).toBe(
      "clean",
    );
  });

  it("disses them at 45 on the first cuss, 60 on the second, then higher", () => {
    expect(conversationHeat("x", ["hi", "you're shit"])).toBe(FIRST_CUSS);
    expect(heatBand(FIRST_CUSS)).toBe("medium");
    expect(conversationHeat("x", ["you're shit", "fuck off"])).toBe(SECOND_CUSS);
    const third = conversationHeat("x", ["you're shit", "fuck off", "come at me then you prick"]);
    expect(third).toBeGreaterThan(SECOND_CUSS);
    const lots = conversationHeat("x", Array(8).fill("fuck off"));
    expect(lots).toBe(100);
    expect(heatBand(lots)).toBe("savage");
  });

  it("eases down when they're polite and resets when something's serious", () => {
    expect(conversationHeat("x", ["fuck off", "thanks, that helps"])).toBeLessThan(FIRST_CUSS);
    expect(conversationHeat("x", ["fuck off", "shit bot", "my nan passed away"])).toBe(0);
    expect(conversationHeat("x", ["fuck off", "i'm really depressed", "you're shit"])).toBe(
      FIRST_CUSS,
    );
  });

  it("knows a cuss from plain chat", () => {
    expect(isCuss("you're fucking useless mate")).toBe(true);
    expect(isCuss("what time is it in tokyo")).toBe(false);
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
