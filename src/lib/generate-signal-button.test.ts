import { describe, expect, it } from "vitest";
import {
  GENERATE_SIGNAL_KEYBOARD,
  GENERATE_SIGNAL_TEXT,
  isGenerateSignal,
} from "./telegram-signals";

describe("the always-on signal button", () => {
  it("is one persistent, full-width button", () => {
    expect(GENERATE_SIGNAL_KEYBOARD.keyboard).toEqual([[{ text: GENERATE_SIGNAL_TEXT }]]);
    expect(GENERATE_SIGNAL_KEYBOARD.is_persistent).toBe(true);
    expect(GENERATE_SIGNAL_TEXT).not.toContain("\n");
  });
  it("recognises its tap, give or take emoji and case, and nothing else", () => {
    expect(isGenerateSignal("⚡ Generate BTC Signal Now")).toBe(true);
    expect(isGenerateSignal("generate btc signal now")).toBe(true);
    expect(isGenerateSignal("Generate BTC signal")).toBe(true);
    expect(isGenerateSignal("can you generate btc signal now please")).toBe(false);
    expect(isGenerateSignal("signal btc")).toBe(false);
  });
});
