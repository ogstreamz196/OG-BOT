// The Boss's manual trade card in the Copy Trader B0T (the partner's to-do #4,
// 2026-11-12): pick the market and side, a fixed lot or an account-risk %, and
// the stop and target distances with tap buttons, then Place → "Yes, place
// it" (two taps, so one slip can't open a trade). The draft is kept in
// site_content "copy.manualDraft"; placing it is manual-trade.server.ts. The
// card text, buttons and tap handling here are pure so they can be tested.
import {
  buildManualTrade,
  clampSl,
  clampTp,
  MANUAL_DEFAULTS,
  MARKET_LABEL,
  type Market,
} from "./manual-trade";

export const DRAFT_KEY = "copy.manualDraft";
export const MANUAL_BUTTON = "✋ Manual trade";
export const MANUAL_LOTS = [0.01, 0.05, 0.1, 0.5];
export const MANUAL_RISKS = [0.5, 1, 2];

export type Draft = {
  market: Market;
  direction: "BUY" | "SELL";
  /** A fixed lot, or (when null) the account-risk %. */
  lot: number | null;
  riskPct: number | null;
  sl: number;
  tp: number;
  /** Waiting for "Yes, place it". */
  confirming?: boolean;
};

export const DEFAULT_DRAFT: Draft = {
  market: "XAUUSD",
  direction: "BUY",
  lot: 0.05,
  riskPct: null,
  sl: MANUAL_DEFAULTS.XAUUSD.sl,
  tp: MANUAL_DEFAULTS.XAUUSD.tp,
};

/** A stored draft, cleaned (anything broken falls back to the default). Pure. */
export function parseDraft(value: string | null | undefined): Draft {
  try {
    const d = JSON.parse(value ?? "") as Partial<Draft>;
    const market: Market = d.market === "BTCUSD" ? "BTCUSD" : "XAUUSD";
    const lot = MANUAL_LOTS.includes(Number(d.lot)) ? Number(d.lot) : null;
    const riskPct = MANUAL_RISKS.includes(Number(d.riskPct)) ? Number(d.riskPct) : null;
    return {
      market,
      direction: d.direction === "SELL" ? "SELL" : "BUY",
      lot: lot ?? (riskPct ? null : 0.05),
      riskPct: lot ? null : riskPct,
      sl: clampSl(market, Number(d.sl) || MANUAL_DEFAULTS[market].sl),
      tp: clampTp(market, Number(d.tp) || MANUAL_DEFAULTS[market].tp),
      confirming: d.confirming === true,
    };
  } catch {
    return { ...DEFAULT_DRAFT };
  }
}

const money = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The size line: the fixed lot, or the risk % with the lot it works out to now. Pure. */
export function sizeLine(d: Draft, balance: number | null): string {
  if (d.lot) return `📏 Size: ${d.lot} lot`;
  const pct = d.riskPct ?? 1;
  if (!(balance && balance > 0)) return `📏 Size: risk ${pct}% of the test account`;
  // The lot doesn't depend on the price, only on the stop distance.
  const t = buildManualTrade({
    market: d.market,
    direction: d.direction,
    price: 1_000_000,
    slDistance: d.sl,
    tpDistance: d.tp,
    riskPct: pct,
    balance,
  });
  return t
    ? `📏 Size: risk ${pct}% of the ${money(balance)} test account → ${t.lot} lot (${money(t.riskAmount ?? 0)} if stopped)`
    : `📏 Size: risk ${pct}% of ${money(balance)} is too small for 0.01 lot at this stop`;
}

/** The card's text. Pure. */
export function manualText(d: Draft, balance: number | null, note?: string): string {
  const name = MARKET_LABEL[d.market];
  const rr = (d.tp / d.sl).toFixed(1).replace(/\.0$/, "");
  return [
    ...(note ? [note, ""] : []),
    d.confirming ? "✋ MANUAL TRADE: PLACE IT?" : "✋ MANUAL TRADE",
    "",
    `${d.direction === "BUY" ? "🟢 BUY" : "🔴 SELL"} ${name} at the price when you place it`,
    sizeLine(d, balance),
    `🛑 Stop: ${money(d.sl)} away · 🎯 Target: ${money(d.tp)} away (1:${rr})`,
    "",
    d.confirming
      ? "It goes in the signals chat, the bot follows it, and every copier copies it at this size."
      : "Set it up, then tap ✅ Place trade.",
  ].join("\n");
}

type Button = { text: string; callback_data: string };

/** The card's buttons; ✅ marks what's chosen. Pure. */
export function manualKeyboard(d: Draft): { inline_keyboard: Button[][] } {
  if (d.confirming)
    return {
      inline_keyboard: [
        [{ text: "✅ Yes, place it", callback_data: "mt:go" }],
        [{ text: "↩️ Back", callback_data: "mt:back" }],
      ],
    };
  const tick = (on: boolean, label: string) => `${on ? "✅ " : ""}${label}`;
  const step = MANUAL_DEFAULTS[d.market].step;
  return {
    inline_keyboard: [
      [
        { text: tick(d.market === "XAUUSD", "🥇 Gold"), callback_data: "mt:mk:XAUUSD" },
        { text: tick(d.market === "BTCUSD", "₿ Bitcoin"), callback_data: "mt:mk:BTCUSD" },
      ],
      [
        { text: tick(d.direction === "BUY", "🟢 BUY"), callback_data: "mt:dir:BUY" },
        { text: tick(d.direction === "SELL", "🔴 SELL"), callback_data: "mt:dir:SELL" },
      ],
      MANUAL_LOTS.map((n) => ({
        text: tick(d.lot === n, `${n} lot`),
        callback_data: `mt:lot:${n}`,
      })),
      MANUAL_RISKS.map((n) => ({
        text: tick(!d.lot && d.riskPct === n, `Risk ${n}%`),
        callback_data: `mt:risk:${n}`,
      })),
      [
        { text: "➖", callback_data: `mt:sl:-${step}` },
        { text: `🛑 Stop ${money(d.sl)}`, callback_data: "mt:noop" },
        { text: "➕", callback_data: `mt:sl:${step}` },
      ],
      [
        { text: "➖", callback_data: `mt:tp:-${step}` },
        { text: `🎯 Target ${money(d.tp)}`, callback_data: "mt:noop" },
        { text: "➕", callback_data: `mt:tp:${step}` },
      ],
      [
        { text: "✅ Place trade", callback_data: "mt:place" },
        { text: "✖️ Cancel", callback_data: "mt:cancel" },
      ],
    ],
  };
}

/**
 * One tap on the card: the new draft (or null to close the card), what to do
 * ("place" to place it now) and the toast. Pure.
 */
export function applyManualTap(
  d: Draft,
  data: string,
): { draft: Draft | null; place: boolean; toast: string } {
  const [, kind, val] = data.split(":");
  const keep = (next: Draft, toast = "") => ({ draft: next, place: false, toast });
  switch (kind) {
    case "mk": {
      const market: Market = val === "BTCUSD" ? "BTCUSD" : "XAUUSD";
      if (market === d.market) return keep(d);
      // A new market starts from its own sensible distances (gold is tighter).
      const m = MANUAL_DEFAULTS[market];
      return keep({ ...d, market, sl: m.sl, tp: m.tp }, MARKET_LABEL[market]);
    }
    case "dir":
      return keep(
        { ...d, direction: val === "SELL" ? "SELL" : "BUY" },
        val === "SELL" ? "SELL" : "BUY",
      );
    case "lot": {
      const n = Number(val);
      return MANUAL_LOTS.includes(n) ? keep({ ...d, lot: n, riskPct: null }, `${n} lot`) : keep(d);
    }
    case "risk": {
      const n = Number(val);
      return MANUAL_RISKS.includes(n)
        ? keep({ ...d, lot: null, riskPct: n }, `Risk ${n}% of the account`)
        : keep(d);
    }
    case "sl":
      return keep({ ...d, sl: clampSl(d.market, d.sl + Number(val)) });
    case "tp":
      return keep({ ...d, tp: clampTp(d.market, d.tp + Number(val)) });
    case "place":
      return keep({ ...d, confirming: true }, "Check it, then tap Yes");
    case "back":
      return keep({ ...d, confirming: false });
    case "go":
      return d.confirming
        ? { draft: { ...d, confirming: false }, place: true, toast: "Placing…" }
        : keep(d);
    case "cancel":
      return { draft: null, place: false, toast: "Cancelled" };
    default:
      return keep(d);
  }
}
