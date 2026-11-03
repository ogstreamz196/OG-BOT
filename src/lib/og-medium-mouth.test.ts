import { describe, expect, it } from "vitest";
import { buildSystemPrompt, ensureMildFlavour } from "./og-persona.server";
import {
  NUDGE_MARK,
  awakeHours,
  chatNudgeDue,
  dueForNudge,
  pickNudge,
} from "./og-idle-nudge.server";

const user = { display_name: null, email: null, coin_balance: 0, is_admin: false, is_vip: false };
const base = { mode: "og" as const, bossScript: null, bossVoice: null, bossDictionary: null, user };

describe("medium Foul Mouth", () => {
  it("everyday chat is medium; only cuss battles go full savage", () => {
    const everyday = buildSystemPrompt({ ...base, foulMouth: true });
    expect(everyday).toContain("turned to MEDIUM");
    expect(everyday).not.toContain("filthy British mouth");
    const battle = buildSystemPrompt({ ...base, foulMouth: true, heat: "battle" });
    expect(battle).toContain("filthy British mouth");
  });

  it("the first reply of a conversation is polite", () => {
    expect(buildSystemPrompt({ ...base, foulMouth: true, firstReply: true })).toContain(
      "No swearing and no insults in this reply",
    );
    expect(buildSystemPrompt({ ...base, foulMouth: true })).not.toContain("FIRST MESSAGE");
  });

  it("adds a mild swear only now and then, never to a reply that already has one", () => {
    expect(ensureMildFlavour("Here you go.", () => 0.9)).toBe("Here you go.");
    expect(ensureMildFlavour("Here you go.", () => 0.1)).not.toBe("Here you go.");
    expect(ensureMildFlavour("Bloody hell, here.", () => 0.1)).toBe("Bloody hell, here.");
  });
});

describe("the I'm bored nudge", () => {
  const now = Date.parse("2026-11-03T14:00:00Z");
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

  it("goes once, an hour after the last message", () => {
    const rows = [
      { user_id: "a", role: "assistant", content: "hi", created_at: at(70) },
      { user_id: "b", role: "user", content: "yo", created_at: at(30) },
      { user_id: "c", role: "assistant", content: "bored" + NUDGE_MARK, created_at: at(90) },
      { user_id: "d", role: "user", content: "old", created_at: at(60 * 30) },
    ];
    expect(dueForNudge(rows, now)).toEqual(["a"]);
  });

  it("is polite: a gold or BTC fact and a question, no swearing", () => {
    for (let i = 0; i < 20; i++) {
      const n = pickNudge(() => i / 20);
      expect(n).toMatch(/bitcoin|BTC|gold|satoshi|XAU/i);
      expect(n).not.toMatch(/fuck|shit|dick|twat|bloody|roast/i);
    }
  });

  it("only in the daytime, UK time", () => {
    expect(awakeHours(Date.parse("2026-11-03T14:00:00Z"))).toBe(true);
    expect(awakeHours(Date.parse("2026-11-03T23:30:00Z"))).toBe(false);
  });
});

describe("the signals chat's I'm bored message", () => {
  const now = Date.parse("2026-11-03T14:00:00Z");
  const ago = (m: number) => now - m * 60_000;
  it("goes after an hour of quiet, then at most once an hour", () => {
    expect(chatNudgeDue(ago(30), null, now)).toBe(false);
    expect(chatNudgeDue(ago(61), null, now)).toBe(true);
    expect(chatNudgeDue(ago(200), new Date(ago(20)).toISOString(), now)).toBe(false);
    expect(chatNudgeDue(ago(200), new Date(ago(61)).toISOString(), now)).toBe(true);
    expect(chatNudgeDue(NaN, null, now)).toBe(true);
  });
});
