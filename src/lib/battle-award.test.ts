import { describe, expect, it } from "vitest";
import { calibrateAward, estimateRoastFloor, nextStreak, streakBonus } from "./community.functions";

describe("estimateRoastFloor", () => {
  it("recognises clear insults even if the external judge returns zero", () => {
    expect(estimateRoastFloor("Ok go fuck ur mum")).toBeGreaterThanOrEqual(3);
    expect(estimateRoastFloor("Suck her left testical")).toBeGreaterThanOrEqual(3);
    expect(estimateRoastFloor("Dese nuts on ur mums chin")).toBeGreaterThanOrEqual(3);
    expect(
      estimateRoastFloor("I will put two O and a big 1 in ur mums bum"),
    ).toBeGreaterThanOrEqual(3);
  });

  it("does not reward normal messages, diagnostics, or profanity without a target", () => {
    expect(estimateRoastFloor("hello everyone")).toBe(0);
    expect(estimateRoastFloor("why did you run out of room again")).toBe(0);
    expect(estimateRoastFloor("this is fucking brilliant")).toBe(0);
  });
});

describe("calibrateAward", () => {
  it("gives nothing for empty or repeated messages", () => {
    expect(calibrateAward(8, "   ", 0, false)).toBe(0);
    expect(calibrateAward(8, "same line", 0, true)).toBe(0);
  });

  it("does not award random chat", () => {
    expect(calibrateAward(0, "how is everyone doing today?", 0, false, () => 0)).toBe(0);
  });

  it("makes small Battle wins easier", () => {
    expect(calibrateAward(1, "you are rubbish", 0, false, () => 0.9)).toBe(0);
    expect(calibrateAward(2, "you are rubbish", 0, false, () => 0)).toBe(1);
    expect(calibrateAward(2, "you are rubbish", 0, false, () => 0.99)).toBe(1);
  });

  it("keeps one-word grunts at zero", () => {
    expect(calibrateAward(0, "lol", 0, false)).toBe(0);
  });

  it("randomises drops inside quality bands", () => {
    expect(calibrateAward(3, "a decent original roast line", 0, false, () => 0)).toBe(1);
    expect(calibrateAward(3, "a decent original roast line", 0, false, () => 0.99)).toBe(2);
    expect(calibrateAward(7, "a strong original roast line", 0, false, () => 0)).toBe(4);
    expect(calibrateAward(7, "a strong original roast line", 0, false, () => 0.99)).toBe(7);
  });

  it("reserves the biggest drops for exceptional insults", () => {
    expect(calibrateAward(10, "an elite devastating original punchline", 8, false, () => 0)).toBe(
      7,
    );
    expect(
      calibrateAward(10, "an elite devastating original punchline", 8, false, () => 0.99),
    ).toBe(10);
  });
});

describe("daily streaks", () => {
  it("starts a streak on the first battle", () => {
    expect(nextStreak(0, null, "2026-09-29").days).toBe(1);
  });
  it("extends on consecutive days", () => {
    expect(nextStreak(2, "2026-09-28", "2026-09-29").days).toBe(3);
  });
  it("keeps the streak within the same day", () => {
    expect(nextStreak(3, "2026-09-29", "2026-09-29").days).toBe(3);
  });
  it("resets after a missed day", () => {
    expect(nextStreak(5, "2026-09-26", "2026-09-29").days).toBe(1);
  });
  it("pays bonuses at 3 and 7 days only", () => {
    expect(streakBonus(2)).toBe(0);
    expect(streakBonus(3)).toBe(2);
    expect(streakBonus(7)).toBe(3);
  });
});

import { shapeDailyReward, BATTLE_DAILY_CAP_TENTHS } from "./community.functions";
describe("hidden daily battle ceiling", () => {
  it("caps the day at 2 coins", () => {
    expect(BATTLE_DAILY_CAP_TENTHS).toBe(20);
    expect(shapeDailyReward(10, 19)).toBe(1);
    expect(shapeDailyReward(10, 20)).toBe(0);
  });
  it("always pays the first insult at least 0.5 coin", () => {
    expect(shapeDailyReward(1, 0)).toBe(5);
    expect(shapeDailyReward(9, 0)).toBe(9);
  });
  it("pays small increments after the first", () => {
    expect(shapeDailyReward(10, 5)).toBe(2);
    expect(shapeDailyReward(1, 5)).toBe(1);
  });
  it("pays nothing for non-scoring lines", () => {
    expect(shapeDailyReward(0, 0)).toBe(0);
  });
});
