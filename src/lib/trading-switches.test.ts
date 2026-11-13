import { describe, expect, it } from "vitest";
import { allowedAction } from "./trading-switches.functions";
import { applyPanelAction, panelKeyboard } from "./copy-settings-bot.server";
import { applyStrategyTap } from "./engine-strategies-bot.server";
import { DEFAULT_ENGINE_CONFIG } from "./engine-config";

describe("website trading switches", () => {
  it("accepts every switch action the copier card offers", () => {
    const strat = { sniper: true, hedges: false, rangeHedge: true, patternsAlongside: false };
    const card = panelKeyboard({ hft: true, useBrokerStop: false }, strat);
    const actions = card.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter((d): d is string => !!d && !/noop|late|refresh/.test(d));
    for (const a of actions) expect(allowedAction(a), a).toBe(true);
  });

  it("refuses anything else", () => {
    for (const a of [
      "cs:mult:4",
      "cs:lot:0.1",
      "cs:band:huge",
      "es:other:on",
      "cs:open:5",
      3,
      null,
      "",
    ])
      expect(allowedAction(a), String(a)).toBe(false);
  });

  it("each switch does its own job", () => {
    expect(applyPanelAction({}, "cs:pause").next).toMatchObject({ paused: true });
    expect(applyPanelAction({ paused: true }, "cs:resume").next).toMatchObject({ paused: false });
    expect(applyPanelAction({}, "cs:hft:on").next).toMatchObject({ hft: true });
    expect(applyPanelAction({}, "cs:stop:on").next).toMatchObject({ useBrokerStop: true });
    expect(applyPanelAction({}, "cs:mk:XAUUSD").next).toMatchObject({ markets: ["BTCUSD"] });
    expect(applyPanelAction({}, "cs:band:large").next).toMatchObject({ lotBand: "large" });
    expect(applyPanelAction({}, "cs:open:1").next).toMatchObject({ maxOpen: 7 });
    for (const k of ["sniper", "hedges", "rangeHedge", "patternsAlongside"] as const)
      expect(applyStrategyTap(DEFAULT_ENGINE_CONFIG, `es:${k}:on`).next?.strategies[k]).toBe(true);
  });
});
