import { describe, expect, it } from "vitest";
import { buildSystemPrompt, ensureMildFlavour } from "./og-persona.server";
import {
  NUDGE_MARK,
  awakeHours,
  chatNudgeDue,
  dueForNudge,
  lastOf,
  pickNudge,
  quietFor,
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

  it("is polite: a Bitcoin fact and a question, no swearing, no gold", () => {
    for (let i = 0; i < 20; i++) {
      const n = pickNudge(() => i / 20, 75 * 60_000);
      expect(n).toMatch(/bitcoin|BTC|satoshi/i);
      expect(n).not.toMatch(/\bgold\b|XAU/i);
      expect(n).not.toMatch(/fuck|shit|dick|twat|bloody|roast/i);
    }
  });

  it("says how long it's really been quiet (31 minutes isn't an hour)", () => {
    expect(quietFor(31 * 60_000)).toBe("31 minutes");
    expect(quietFor(60 * 60_000)).toBe("an hour");
    expect(quietFor(63 * 60_000)).toBe("an hour");
    expect(quietFor(95 * 60_000)).toBe("1 hour 35 minutes");
    expect(quietFor(125 * 60_000)).toBe("2 hours 5 minutes");
    expect(quietFor(180 * 60_000)).toBe("3 hours");
    // The "nobody's said a word" opener (index 3 of 5) names the real time.
    const n = pickNudge(() => 0.6, 95 * 60_000);
    expect(n).toContain("Nobody's said a word for 1 hour 35 minutes");
    // Without a known quiet time, no opener names one.
    for (let i = 0; i < 20; i++) expect(pickNudge(() => i / 20)).not.toContain("{quiet}");
    expect(pickNudge(() => 0.6)).not.toMatch(/Nobody's said a word/);
  });

  it("group chat counts as activity, not just signal cards", () => {
    const at = Date.parse("2026-11-05T20:04:00Z");
    const card = Date.parse("2026-11-05T18:50:00Z");
    const chat = Date.parse("2026-11-05T19:33:00Z");
    // The screenshot: a card at 18:50, people chatting at 19:33, 20:04 now.
    expect(chatNudgeDue(lastOf([card, chat]), null, at)).toBe(false);
    expect(lastOf([card, NaN])).toBe(card);
    expect(lastOf([NaN])).toBeNaN();
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
