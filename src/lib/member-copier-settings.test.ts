import { describe, expect, it } from "vitest";
import {
  applySettingTap,
  isMyCommand,
  memberSettings,
  MY_BUTTON,
  myPanel,
  newKey,
  parseKey,
  parseMyTap,
} from "./copier-keys";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const key = () => newKey("a".repeat(64), "Sam", 30, NOW);
const datas = (p: ReturnType<typeof myPanel>) =>
  p.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

describe("members' own copier settings (lot size and pairs)", () => {
  it("the card offers the lot range and pairs, ticked as set", () => {
    const p = myPanel({ ...key(), lotBand: "medium", markets: ["BTCUSD"] }, NOW);
    expect(p.text).toMatch(/Lot size: Medium 0\.02–0\.1/);
    expect(p.text).toMatch(/Pairs: Bitcoin/);
    expect(datas(p)).toEqual(
      expect.arrayContaining(["ck:me:band:small", "ck:me:band:large", "ck:me:mk:XAUUSD"]),
    );
    const texts = p.reply_markup.inline_keyboard.flat().map((b) => b.text);
    expect(texts).toContain("✅ Medium");
    expect(texts).toContain("❌ Gold");
    expect(texts).toContain("✅ Bitcoin");
    // Unset: the Boss's settings, both pairs.
    expect(myPanel(key(), NOW).text).toMatch(/the Boss's setting/);
  });

  it("taps change only that member's key", () => {
    expect(parseMyTap("ck:me:band:large")).toEqual({ band: "large" });
    expect(parseMyTap("ck:me:mk:XAUUSD")).toEqual({ market: "XAUUSD" });
    expect(parseMyTap("ck:me:band:huge")).toBeNull();
    const a = applySettingTap(key(), { band: "small" });
    expect(a.key.lotBand).toBe("small");
    const b = applySettingTap(a.key, { market: "XAUUSD" });
    expect(b.key.markets).toEqual(["BTCUSD"]);
    expect(b.toast).toMatch(/Gold: off/);
    const c = applySettingTap(b.key, { market: "XAUUSD" });
    expect(c.key.markets).toEqual(["XAUUSD", "BTCUSD"]);
    // Kept through save and load.
    expect(parseKey(JSON.stringify(b.key))).toMatchObject({
      lotBand: "small",
      markets: ["BTCUSD"],
    });
  });

  it("the feed gives a member their own range and pairs over the Boss's, never a pair he switched off", () => {
    const shared = { paused: false, lotBand: "large" as string, markets: ["XAUUSD"], hft: true };
    expect(memberSettings(shared, null)).toEqual(shared);
    const mine = memberSettings(shared, { lotBand: "small", markets: ["XAUUSD", "BTCUSD"] });
    expect(mine.lotBand).toBe("small");
    expect(mine.markets).toEqual(["XAUUSD"]);
    expect(mine.hft).toBe(true);
    expect(shared.lotBand).toBe("large");
    // A fixed lot the Boss typed gives way to the member's range.
    expect("lot" in memberSettings({ lot: 0.2 }, { lotBand: "medium" })).toBe(false);
  });

  it("the 📟 button opens their card", () => {
    expect(isMyCommand(MY_BUTTON)).toBe(true);
    expect(isMyCommand("/copier")).toBe(true);
  });
});
