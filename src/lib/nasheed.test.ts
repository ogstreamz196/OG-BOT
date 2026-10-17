import { describe, expect, it } from "vitest";
import {
  isNasheedStyle,
  songIsNasheed,
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

describe("songIsNasheed", () => {
  const client = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  });
  it("reads the flag", async () => {
    expect(await songIsNasheed(client({ data: { is_nasheed: true }, error: null }), "s")).toBe(
      true,
    );
    expect(await songIsNasheed(client({ data: { is_nasheed: false }, error: null }), "s")).toBe(
      false,
    );
  });
  it("treats a missing column (migration not applied yet) as not a Nasheed", async () => {
    const missing = client({
      data: null,
      error: { message: "column songs.is_nasheed does not exist" },
    });
    expect(await songIsNasheed(missing, "s")).toBe(false);
  });
});
