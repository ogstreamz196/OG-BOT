import { describe, expect, it } from "vitest";
import { resetPanel } from "./purge-bot.server";

describe("purge card with a connected real account", () => {
  it("offers the real balance as the first choice, and starts there", () => {
    const p = resetPanel(4321, null, { realBalance: 4321 });
    const first = p.reply_markup.inline_keyboard[0]?.[0];
    expect(first?.callback_data).toBe("rs:bal:4321");
    expect(first?.text).toContain("Real account");
    expect(p.text).toContain("New start balance: $4,321");
  });
  it("keeps the fixed choices when no real account is connected", () => {
    const p = resetPanel(1000, null);
    expect(p.reply_markup.inline_keyboard.flat().some((b) => b.text.includes("Real account"))).toBe(false);
  });
});
