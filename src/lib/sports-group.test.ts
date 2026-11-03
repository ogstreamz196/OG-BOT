import { describe, expect, it } from "vitest";
import {
  banterDue,
  daytimeUK,
  isSportsGuideChat,
  isWhichGameAsk,
  looksLikeListing,
  memberFixturesReply,
  nonMemberJabLine,
  nonMemberLockReply,
  pickGroupBanter,
  royalChatLine,
  splitFixtures,
} from "./sports-group.server";
import type { Fixture } from "./sports-listing";

const fix = (event: string, mins: number | null, channel = "Sky Sports"): Fixture => ({
  event,
  channel,
  at: mins === null ? null : new Date(Date.now() + mins * 60_000),
  raw: `${event}-${mins}`,
});

describe("sports group", () => {
  it("knows the guide chat", () => {
    expect(isSportsGuideChat(-1002011722570)).toBe(true);
    expect(isSportsGuideChat(123)).toBe(false);
  });

  it("tells a listing from a person's question", () => {
    expect(looksLikeListing("EPL01: Liverpool 14:00 Brighton 25/10")).toBe(true);
    expect(looksLikeListing("DAZN CA 01: Italy vs. Türkiye 10-05 19:45 GMT")).toBe(true);
    expect(looksLikeListing("which game is on tonight?")).toBe(false);
    expect(looksLikeListing("yooo anyone watching the footy")).toBe(false);
  });

  it("spots a 'which game is on' ask", () => {
    for (const q of ["which game is on?", "what's on tonight", "any footy today?", "who's playing", "fixtures?", "what games are on"])
      expect(isWhichGameAsk(q)).toBe(true);
    expect(isWhichGameAsk("hello mate how are you")).toBe(false);
  });

  it("splits fixtures into live, upcoming and finished", () => {
    const s = splitFixtures([fix("Live FC", -30), fix("Soon FC", 90), fix("Done FC", -200), fix("TBC FC", null)]);
    expect(s.live.map((f) => f.event)).toEqual(["Live FC"]);
    expect(s.upcoming.map((f) => f.event)).toContain("Soon FC");
    expect(s.upcoming.map((f) => f.event)).toContain("TBC FC");
    expect(s.finished.map((f) => f.event)).toEqual(["Done FC"]);
  });

  it("gives members royalty and the list, non-members a block", () => {
    const s = splitFixtures([fix("Arsenal v Spurs", 60)]);
    const royal = memberFixturesReply(s, () => 0);
    expect(royal).toContain("Arsenal v Spurs");
    expect(royal).toContain("Coming up");
    const locked = nonMemberLockReply("Dave", () => 0);
    expect(locked).toContain("Dave");
    expect(locked.toLowerCase()).toContain("unlock");
    expect(royalChatLine("Dave", () => 0)).toBeTruthy();
    expect(nonMemberJabLine("Dave", () => 0)).toContain("Dave");
  });

  it("picks banter and gates it by time", () => {
    const s = splitFixtures([fix("Chelsea v City", 120), fix("Rangers v Celtic", -180)]);
    expect(pickGroupBanter(s, () => 0)).toContain("Chelsea v City");
    const now = Date.parse("2026-11-03T15:00:00Z");
    expect(banterDue(null, now)).toBe(true);
    expect(banterDue(new Date(now - 60 * 60_000).toISOString(), now)).toBe(false);
    expect(banterDue(new Date(now - 4 * 3_600_000).toISOString(), now)).toBe(true);
    expect(typeof daytimeUK(now)).toBe("boolean");
  });
});
