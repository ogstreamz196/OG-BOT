import { describe, expect, it } from "vitest";
import {
  applyCommand,
  asCommand,
  BOSS_BUTTONS,
  bossKeyboard,
  settingsCommand,
  settingsText,
} from "./copy-settings-bot.server";

describe("Boss's copier settings in the copy bot", () => {
  it("knows its commands, with or without the bot's @name", () => {
    expect(settingsCommand("/settings")).toBe("settings");
    expect(settingsCommand("/lot@ogcopybot 0.05")).toBe("lot");
    expect(settingsCommand("/PAUSE")).toBe("pause");
    expect(settingsCommand("/start")).toBeNull();
    expect(settingsCommand("lot 0.05")).toBeNull();
  });
  it("pause, resume and the lot", () => {
    expect(applyCommand({}, "/pause").next).toEqual({ paused: true });
    expect(applyCommand({ paused: true }, "/resume").next).toEqual({ paused: false });
    expect(applyCommand({}, "/lot 0.05").next).toEqual({ lot: 0.05 });
    expect(applyCommand({ lot: 0.05 }, "/lot bot").next).toEqual({ lot: "bot" });
    expect(applyCommand({}, "/lot 9")).toMatchObject({ next: null });
    expect(applyCommand({}, "/lot")).toMatchObject({ next: null });
  });
  it("markets by name, keeping the other settings", () => {
    expect(applyCommand({ lot: "bot" }, "/markets gold").next).toEqual({
      lot: "bot",
      markets: ["XAUUSD"],
    });
    expect(applyCommand({}, "/markets gold, btc").next).toEqual({ markets: ["XAUUSD", "BTCUSD"] });
    expect(applyCommand({}, "/markets all").next).toEqual({ markets: ["XAUUSD", "BTCUSD"] });
    expect(applyCommand({}, "/markets gold eurusd")).toMatchObject({ next: null });
  });
  it("numbers and the broker stop, in range only", () => {
    expect(applyCommand({}, "/maxopen 4").next).toEqual({ maxOpen: 4 });
    expect(applyCommand({}, "/maxopen 99")).toMatchObject({ next: null });
    expect(applyCommand({}, "/late 15").next).toEqual({ maxLateMinutes: 15 });
    expect(applyCommand({}, "/late 0")).toMatchObject({ next: null });
    expect(applyCommand({}, "/brokerstop on").next).toEqual({ useBrokerStop: true });
    expect(applyCommand({}, "/brokerstop maybe")).toMatchObject({ next: null });
  });
  it("shows the settings, defaults where nothing's set", () => {
    const t = settingsText({});
    expect(t).toContain("▶️ Running");
    expect(t).toContain("Lot: bot (same as the copy bot)");
    expect(t).toContain("Markets: XAUUSD, BTCUSD");
    expect(t).toContain("/brokerstop on");
    expect(settingsText({ paused: true, markets: ["XAUUSD"], lot: 0.05 })).toContain("⏸ Paused");
  });
});

describe("the Boss's tap buttons", () => {
  it("each button is a working settings command, and /start opens the settings", () => {
    for (const [button, cmd] of Object.entries(BOSS_BUTTONS)) {
      expect(asCommand(button)).toBe(cmd);
      const c = settingsCommand(cmd);
      expect(c).not.toBeNull();
      if (c !== "settings") expect(applyCommand({}, cmd).next).not.toBeNull();
    }
    expect(asCommand("/start")).toBe("/settings");
    expect(asCommand("hello")).toBe("hello");
  });
  it("the keyboard has every button and keeps the ⚡ signal button", () => {
    const k = bossKeyboard("⚡ Generate BTC Signal Now");
    const texts = k.keyboard.flat().map((b) => b.text);
    for (const b of Object.keys(BOSS_BUTTONS)) expect(texts).toContain(b);
    expect(texts.at(-1)).toBe("⚡ Generate BTC Signal Now");
  });
});
