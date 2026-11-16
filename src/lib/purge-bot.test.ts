import { describe, expect, it } from "vitest";
import {
  applyResetTap,
  cleanBalance,
  RESET_BUTTON,
  resetAsk,
  resetPanel,
  resultNote,
} from "./purge-bot.server";

const datas = (p: ReturnType<typeof resetPanel>) =>
  p.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

describe("purge & reset from the Copy Trader B0T", () => {
  it("opens from the button, /reset or /purge, with an optional balance", () => {
    expect(resetAsk(RESET_BUTTON)).toEqual({ balance: 1000 });
    expect(resetAsk("/reset")).toEqual({ balance: 1000 });
    expect(resetAsk("/purge@ogcopybot")).toEqual({ balance: 1000 });
    expect(resetAsk("/reset 2,500")).toEqual({ balance: 2500 });
    expect(resetAsk("/reset $750")).toEqual({ balance: 750 });
    expect(resetAsk("/reset 5")).toEqual({ balance: null });
    expect(resetAsk("/resets")).toBeUndefined();
    expect(resetAsk("hello")).toBeUndefined();
  });

  it("keeps the balance between $10 and $1,000,000", () => {
    expect(cleanBalance(9)).toBeNull();
    expect(cleanBalance(1_000_001)).toBeNull();
    expect(cleanBalance("1000.555")).toBe(1000.56);
  });

  it("shows the test account now and the balance choices, ticking the chosen one", () => {
    const p = resetPanel(2000, { start: 1000, balance: 1052.3, startedAt: "2026-11-11T21:02:41Z" });
    expect(p.text).toContain("Test account now: $1,052.3 (started at $1,000 on 11 Nov)");
    expect(p.text).toContain("New start balance: $2,000");
    expect(p.text).toContain("Nothing stored is deleted");
    const texts = p.reply_markup.inline_keyboard.flat().map((b) => b.text);
    expect(texts).toContain("✅ $2,000");
    expect(texts).toContain("🧹 Purge & reset at $2,000");
    expect(datas(p)).not.toContain("rs:go:2000");
  });

  it("only purges after Purge then Yes (two taps); Back and Close change nothing", () => {
    expect(applyResetTap("rs:bal:5000")).toEqual({ balance: 5000, show: "card", run: false });
    expect(applyResetTap("rs:ask:5000")).toEqual({ balance: 5000, show: "confirm", run: false });
    const confirm = resetPanel(5000, null, { confirming: true });
    expect(datas(confirm)).toEqual(["rs:go:5000", "rs:back:5000"]);
    expect(applyResetTap("rs:go:5000")).toEqual({ balance: 5000, show: "card", run: true });
    expect(applyResetTap("rs:back:5000")).toMatchObject({ run: false, show: "card" });
    expect(applyResetTap("rs:close:5000")).toMatchObject({ run: false, show: "closed" });
    expect(applyResetTap("rs:go:5")).toBeNull();
    expect(applyResetTap("rs:nope:1000")).toBeNull();
  });

  it("every button fits Telegram's 64-byte limit", () => {
    for (const d of [
      ...datas(resetPanel(1_000_000, null)),
      ...datas(resetPanel(1_000_000, null, { confirming: true })),
    ])
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
  });

  it("says what happened", () => {
    expect(resultNote({ ok: true, swept: 1900, deleteRefused: "x" }, 1000)).toMatch(
      /Done[\s\S]*\$1,000[\s\S]*1,900 message ids swept \(older ones/,
    );
    expect(
      resultNote({ ok: false, why: "the trade bot can't find the signals chat" }, 1000),
    ).toMatch(/^⚠️ Not done: the trade bot can't find the signals chat/);
  });
});
