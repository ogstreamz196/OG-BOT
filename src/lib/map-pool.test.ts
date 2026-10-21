import { describe, expect, it } from "vitest";
import { mapPool } from "./map-pool";

describe("mapPool", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 0], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
