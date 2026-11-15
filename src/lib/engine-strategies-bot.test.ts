import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-config";
import {
  applyStrategyTap,
  asStrategyCommand,
  strategyPanelKeyboard,
  strategyPanelText,
} from "./engine-strategies-bot.server";

describe("engine strategies card", () => {
  it("shows every strategy off by default", () => {
    const text = strategyPanelText(DEFAULT_ENGINE_CONFIG);
    expect(text).toContain("Sniper entries");
    expect(text).toContain("Counter-trend hedges");
    expect(text).toContain("Range hedging");
    expect(text).toContain("Patterns alongside");
    expect(text).not.toContain("✅ ON");
  });

  it("a tap turns a strategy on, then off, and never touches the others", () => {
    const on = applyStrategyTap(DEFAULT_ENGINE_CONFIG, "es:hedges:on");
    expect(on.next?.strategies.hedges).toBe(true);
    expect(on.next?.strategies.sniper).toBe(false);
    expect(on.toast).toContain("ON");
    const off = applyStrategyTap(on.next!, "es:hedges:off");
    expect(off.next?.strategies.hedges).toBe(false);
  });

  it("keeps the rest of the config intact when a toggle flips", () => {
    const next = applyStrategyTap(DEFAULT_ENGINE_CONFIG, "es:rangeHedge:on").next!;
    expect(next.gate).toEqual(DEFAULT_ENGINE_CONFIG.gate);
    expect(next.concurrency).toEqual(DEFAULT_ENGINE_CONFIG.concurrency);
  });

  it("ignores refresh and unknown keys", () => {
    expect(applyStrategyTap(DEFAULT_ENGINE_CONFIG, "es:refresh").next).toBeNull();
    expect(applyStrategyTap(DEFAULT_ENGINE_CONFIG, "es:nope:on").next).toBeNull();
  });

  it("the keyboard offers the opposite action for each toggle", () => {
    const kb = strategyPanelKeyboard(DEFAULT_ENGINE_CONFIG);
    const taps = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(taps).toContain("es:sniper:on");
    expect(taps).toContain("es:hedges:on");
    expect(taps).toContain("es:refresh");
  });

  it("recognises the strategies command", () => {
    expect(asStrategyCommand("🎛 Strategies")).toBe("/strategies");
    expect(asStrategyCommand("/strategies")).toBe("/strategies");
    expect(asStrategyCommand("hello")).toBeNull();
  });
});
