import { describe, expect, it } from "vitest";
import {
  isNasheedStyle,
  trackCardLabel,
  trackCardMinimumPence,
  trackCardQuantity,
  trackCoinCost,
} from "./nasheed";

describe("nasheed pricing", () => {
  it("spots Nasheed as one of the styles only", () => {
    expect(isNasheedStyle("Nasheed")).toBe(true);
    expect(isNasheedStyle("Nasheed, Mix voice, a cappella")).toBe(true);
    expect(isNasheedStyle("Afrobeats, nasheed")).toBe(true);
    expect(isNasheedStyle("Nasheed-inspired drill")).toBe(false);
    expect(isNasheedStyle("")).toBe(false);
    expect(isNasheedStyle(null)).toBe(false);
  });

  it("doubles coins and card price for a Nasheed", () => {
    expect(trackCoinCost(5, false)).toBe(5);
    expect(trackCoinCost(5, true)).toBe(10);
    expect(trackCardQuantity(true)).toBe(2);
    expect(trackCardLabel(false)).toBe("£0.99");
    expect(trackCardLabel(true)).toBe("£1.98");
    expect(trackCardMinimumPence(true)).toBe(198);
  });
});
