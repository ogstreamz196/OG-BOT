import { describe, expect, it } from "vitest";
import {
  applyManualTap,
  DEFAULT_DRAFT,
  manualKeyboard,
  manualText,
  parseDraft,
  sizeLine,
  type Draft,
} from "./manual-trade-bot.server";
import { manualCard } from "./manual-trade.server";

const datas = (d: Draft) =>
  manualKeyboard(d)
    .inline_keyboard.flat()
    .map((b) => b.callback_data);

describe("the Boss's manual trade card", () => {
  it("starts on gold, buy, 0.05 lot, $3 stop and $6 target", () => {
    expect(parseDraft(null)).toEqual(DEFAULT_DRAFT);
    const t = manualText(DEFAULT_DRAFT, 1000);
    expect(t).toContain("🟢 BUY Gold at the price when you place it");
    expect(t).toContain("📏 Size: 0.05 lot");
    expect(t).toContain("🛑 Stop: $3 away · 🎯 Target: $6 away (1:2)");
  });

  it("risk sizing shows the lot it works out to and the dollars at risk", () => {
    const d = { ...DEFAULT_DRAFT, lot: null, riskPct: 1 };
    // 1% of $1,000 = $10 over a $3 gold stop ($300 a lot) = 0.03 lot, $9 at risk.
    expect(sizeLine(d, 1000)).toBe(
      "📏 Size: risk 1% of the $1,000 test account → 0.03 lot ($9 if stopped)",
    );
    expect(sizeLine({ ...d, riskPct: 0.5, sl: 30 }, 100)).toMatch(/too small/);
  });

  it("switching market resets to that market's distances (gold tighter than bitcoin)", () => {
    const btc = applyManualTap(DEFAULT_DRAFT, "mt:mk:BTCUSD").draft!;
    expect(btc).toMatchObject({ market: "BTCUSD", sl: 300, tp: 600 });
    const back = applyManualTap({ ...btc, sl: 900 }, "mt:mk:XAUUSD").draft!;
    expect(back).toMatchObject({ market: "XAUUSD", sl: 3, tp: 6 });
  });

  it("side, lot, risk and the ➖/➕ steps, clamped", () => {
    expect(applyManualTap(DEFAULT_DRAFT, "mt:dir:SELL").draft!.direction).toBe("SELL");
    expect(applyManualTap(DEFAULT_DRAFT, "mt:lot:0.5").draft).toMatchObject({
      lot: 0.5,
      riskPct: null,
    });
    expect(applyManualTap(DEFAULT_DRAFT, "mt:risk:2").draft).toMatchObject({
      lot: null,
      riskPct: 2,
    });
    expect(applyManualTap(DEFAULT_DRAFT, "mt:lot:7").draft!.lot).toBe(0.05);
    expect(applyManualTap(DEFAULT_DRAFT, "mt:sl:0.5").draft!.sl).toBe(3.5);
    expect(applyManualTap({ ...DEFAULT_DRAFT, sl: 0.5 }, "mt:sl:-0.5").draft!.sl).toBe(0.5);
    expect(applyManualTap(DEFAULT_DRAFT, "mt:tp:-0.5").draft!.tp).toBe(5.5);
  });

  it("places only after Place then Yes (two taps); Back and Cancel place nothing", () => {
    expect(applyManualTap(DEFAULT_DRAFT, "mt:go").place).toBe(false);
    const asked = applyManualTap(DEFAULT_DRAFT, "mt:place");
    expect(asked).toMatchObject({ place: false, draft: { confirming: true } });
    expect(datas(asked.draft!)).toEqual(["mt:go", "mt:back"]);
    expect(applyManualTap(asked.draft!, "mt:back")).toMatchObject({
      place: false,
      draft: { confirming: false },
    });
    expect(applyManualTap(asked.draft!, "mt:go")).toMatchObject({ place: true });
    expect(applyManualTap(DEFAULT_DRAFT, "mt:cancel")).toMatchObject({ draft: null, place: false });
  });

  it("every button fits Telegram's 64-byte limit and a broken draft falls back safely", () => {
    for (const d of datas(DEFAULT_DRAFT))
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    expect(parseDraft("{oops")).toEqual(DEFAULT_DRAFT);
    expect(parseDraft(JSON.stringify({ market: "BTCUSD", sl: 999999, lot: 3 }))).toMatchObject({
      market: "BTCUSD",
      sl: 3000,
      lot: 0.05,
    });
  });

  it("the signals-chat card says it's the Boss's manual trade, with the lot", () => {
    const card = manualCard({
      market: "XAUUSD",
      direction: "SELL",
      entry: 3980.5,
      stop: 3983.5,
      tp: 3974.5,
      lot: 0.1,
      fmt: (n) => n.toFixed(2),
    });
    expect(card).toBe(
      [
        "🔴 XAUUSD SELL NOW (Gold)",
        "🎯 Entry: 3980.50 (market)",
        "🛑 Stop: 3983.50",
        "💰 Take profit: 3974.50",
        "✋ Manual trade by the Boss · 0.1 lot",
      ].join("\n"),
    );
  });
});
