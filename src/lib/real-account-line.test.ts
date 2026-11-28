import { describe, expect, it } from "vitest";
import { realBalanceLine } from "./mt5-autotrade.server";

describe("realBalanceLine", () => {
  it("shows the real account balance in dollars, without .00", () => {
    expect(realBalanceLine(1000)).toBe("💰 Real account: $1,000");
  });
  it("keeps cents when there are some", () => {
    expect(realBalanceLine(1234.5)).toBe("💰 Real account: $1,234.50");
  });
});
