import { describe, expect, it, vi } from "vitest";
import { pickTradeHold } from "./trade-hold.server";
import { freshHoldingLines, isHoldingMessage, parseInstrument } from "./trade-signal";

vi.mock("@/lib/og-catchphrases.server", () => ({ refillCatchphrases: vi.fn() }));

const gold = parseInstrument("gold")!;

/** A tiny in-memory stand-in for the catchphrase bank and its seen list. */
function fakeBank(lines: string[]) {
  const bank = [...lines];
  const seen = new Set<string>();
  const calls: string[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(fn);
      if (fn === "add_catchphrases") {
        for (const p of args.p_phrases as string[]) if (!bank.includes(p)) bank.push(p);
        return { data: 1, error: null };
      }
      if (fn === "pick_trade_hold") {
        const unseen = bank.filter((l) => !seen.has(l));
        const phrase = unseen[0] ?? null;
        if (phrase) seen.add(phrase);
        return { data: { phrase, left: bank.filter((l) => !seen.has(l)).length }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { admin, bank, seen, calls };
}

describe("pickTradeHold", () => {
  it("never gives the same user the same line, and fills in the market", async () => {
    const { admin } = fakeBank(["⏳ A {m} next", "⏳ B {m} next", "⏳ C {m} next"]);
    const got = new Set<string>();
    for (let i = 0; i < 10; i++) got.add(await pickTradeHold(admin, "u1", gold, "safe"));
    expect(got.size).toBe(10);
    for (const line of got) {
      expect(line).toContain("XAU/USD (Gold)");
      expect(isHoldingMessage(line)).toBe(true);
    }
  });

  it("adds brand-new lines to the shared bank once a user has seen them all", async () => {
    const { admin, bank, calls } = fakeBank(["⏳ only {m} next"]);
    await pickTradeHold(admin, "u1", gold, "foul");
    await pickTradeHold(admin, "u1", gold, "foul");
    expect(calls).toContain("add_catchphrases");
    expect(bank.length).toBeGreaterThan(1);
  });

  it("asks for an AI top-up when a user's unseen supply runs low", async () => {
    const { refillCatchphrases } = await import("@/lib/og-catchphrases.server");
    const { admin } = fakeBank(["⏳ x {m} next", "⏳ y {m} next"]);
    await pickTradeHold(admin, "u1", gold, "cheeky");
    expect(refillCatchphrases).toHaveBeenCalledWith(admin, "trade_hold", "cheeky");
  });

  it("falls back to a built-in line if the bank is unavailable", async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: "down" } }) };
    const line = await pickTradeHold(admin, "u1", gold, "safe");
    expect(line).toContain("XAU/USD (Gold)");
    expect(isHoldingMessage(line)).toBe(true);
  });
});

describe("freshHoldingLines", () => {
  it("builds distinct lines with the market placeholder", () => {
    const lines = freshHoldingLines("cheeky", 8);
    expect(new Set(lines).size).toBe(lines.length);
    for (const l of lines) expect(l).toMatch(/^⏳ .*\{m\}/);
  });

  it("keeps the clean tone clean", () => {
    for (const l of freshHoldingLines("safe", 30)) {
      expect(l).not.toMatch(/fuck|shit|bastard|bellend|sod|tits|degen/i);
    }
  });
});
