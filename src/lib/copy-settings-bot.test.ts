import { describe, expect, it } from "vitest";
import {
  applyCommand,
  applyPanelAction,
  asCommand,
  bossKeyboard,
  LOT_CHOICES,
  OPEN_BUTTON,
  panelKeyboard,
  panelText,
  settingsCommand,
} from "./copy-settings-bot.server";

const datas = (s: Parameters<typeof panelKeyboard>[0]) =>
  panelKeyboard(s)
    .inline_keyboard.flat()
    .map((b) => b.callback_data);
const texts = (s: Parameters<typeof panelKeyboard>[0]) =>
  panelKeyboard(s)
    .inline_keyboard.flat()
    .map((b) => b.text);

describe("the copy bot's settings card", () => {
  it("says in plain words what each setting does, defaults when nothing's set", () => {
    const t = panelText({});
    expect(t).toContain("▶️ COPYING: new trades are copied.");
    expect(t).toContain("Lot size: same as the bot");
    expect(t).toContain("Markets: Gold and Bitcoin");
    expect(t).toContain("Max trades open at once: 6");
    expect(t).toContain("Joins a trade up to 10 min after it opens");
    expect(t).toContain("Safety stop on the broker: OFF");
    expect(panelText({ paused: true, lot: 0.05, markets: ["XAUUSD"] })).toMatch(
      /PAUSED[\s\S]*0\.05 on every trade[\s\S]*Markets: Gold\n/,
    );
  });
  it("ticks what's chosen, and every button fits Telegram's 64-byte limit", () => {
    expect(texts({})).toContain("✅ 📏 Lot: same as the bot");
    expect(texts({ markets: ["BTCUSD"] })).toEqual(
      expect.arrayContaining(["🥇 Gold", "✅ ₿ Bitcoin"]),
    );
    expect(texts({ paused: true })).toContain("▶️ Resume copying");
    for (const d of datas({})) expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
  });
  it("every button does what it says", () => {
    expect(applyPanelAction({}, "cs:pause").next).toEqual({ paused: true });
    expect(applyPanelAction({ paused: true }, "cs:resume").next).toEqual({ paused: false });
    for (const n of [] as number[])
      expect(applyPanelAction({}, `cs:lot:${n}`).next).toEqual({ lot: n });
    expect(applyPanelAction({ lot: 0.05 }, "cs:lot:bot").next).toEqual({ lot: "bot" });
    expect(applyPanelAction({}, "cs:mk:XAUUSD").next).toEqual({ markets: ["BTCUSD"] });
    expect(applyPanelAction({ markets: ["BTCUSD"] }, "cs:mk:XAUUSD").next).toEqual({
      markets: ["XAUUSD", "BTCUSD"],
    });
    expect(applyPanelAction({}, "cs:open:1").next).toEqual({ maxOpen: 7 });
    expect(applyPanelAction({}, "cs:late:-5").next).toEqual({ maxLateMinutes: 5 });
    expect(applyPanelAction({}, "cs:stop:on").next).toEqual({ useBrokerStop: true });
  });
  it("won't leave no markets or go out of range; refresh and labels change nothing", () => {
    expect(applyPanelAction({ markets: ["XAUUSD"] }, "cs:mk:XAUUSD")).toMatchObject({ next: null });
    expect(applyPanelAction({ maxOpen: 1 }, "cs:open:-1")).toMatchObject({ next: null });
    expect(applyPanelAction({ maxLateMinutes: 60 }, "cs:late:5")).toMatchObject({ next: null });
    expect(applyPanelAction({}, "cs:refresh").next).toBeNull();
    expect(applyPanelAction({}, "cs:noop").next).toBeNull();
    expect(applyPanelAction({}, "cs:lot:7").next).toBeNull();
  });
  it("every button on the card is handled", () => {
    for (const d of datas({}))
      if (d !== "cs:noop" && d !== "cs:refresh") expect(applyPanelAction({}, d).toast).not.toBe("");
  });
});

describe("typed commands still work", () => {
  it("knows its commands; /start and the ⚙️ button open the card", () => {
    expect(settingsCommand("/lot@ogcopybot 0.1")).toBe("lot");
    expect(settingsCommand("/start")).toBeNull();
    expect(asCommand("/start")).toBe("/settings");
    expect(asCommand(OPEN_BUTTON)).toBe("/settings");
    expect(asCommand("hello")).toBe("hello");
  });
  it("values the buttons don't offer", () => {
    expect(applyCommand({}, "/lot 0.3").next).toEqual({ lot: 0.3 });
    expect(applyCommand({}, "/maxopen 12").next).toEqual({ maxOpen: 12 });
    expect(applyCommand({}, "/late 25").next).toEqual({ maxLateMinutes: 25 });
    expect(applyCommand({}, "/markets gold").next).toEqual({ markets: ["XAUUSD"] });
    expect(applyCommand({}, "/lot 9")).toMatchObject({ next: null });
  });
  it("the Boss's keyboard: ⚙️ settings above the ⚡ signal button", () => {
    expect(
      bossKeyboard("⚡ Generate BTC Signal Now")
        .keyboard.flat()
        .map((b) => b.text),
    ).toEqual([OPEN_BUTTON, "⚡ Generate BTC Signal Now"]);
  });
});

describe("risk multiplier and high-frequency", () => {
  it("offers -4x -2x 1x 2x 4x 10x and saves the pick", () => {
    expect(texts({})).toEqual(expect.arrayContaining(["-4x", "-2x", "✅ 1x", "2x", "4x", "10x"]));
    expect(applyPanelAction({}, "cs:mult:10").next).toEqual({ multiplier: 10 });
    expect(applyPanelAction({}, "cs:mult:0.25").next).toEqual({ multiplier: 0.25 });
    expect(applyPanelAction({}, "cs:mult:3").next).toBeNull();
  });
  it("toggles high-frequency mode", () => {
    expect(applyPanelAction({}, "cs:hft:on").next).toEqual({ hft: true });
    expect(applyPanelAction({ hft: true }, "cs:hft:off").next).toEqual({ hft: false });
  });
});
