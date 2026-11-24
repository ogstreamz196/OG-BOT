import { describe, expect, it } from "vitest";
describe("shouldExtract skips signal requests (saves an AI call each)", () => {
  it("no memory call for chart and signal asks, or commands", async () => {
    const { shouldExtract } = await import("./og-memory");
    expect(shouldExtract("give me a BTC signal please")).toBe(false);
    expect(shouldExtract("can I get a gold scalp on the 5m")).toBe(false);
    expect(shouldExtract("/start my thing please")).toBe(false);
  });
  it("still remembers personal facts, even next to a signal ask", async () => {
    const { shouldExtract } = await import("./og-memory");
    expect(shouldExtract("my name is Dave, give me a btc signal")).toBe(true);
    expect(shouldExtract("I support Arsenal and I live in Leeds")).toBe(true);
  });
});
