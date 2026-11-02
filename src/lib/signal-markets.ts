/**
 * The markets OG B0T gives signals on. The Boss retired gold (2026-11-02):
 * Bitcoin only, with gold's room going to more Bitcoin signals. Everything
 * that scans, learns, auto-trades or lists markets reads SIGNAL_MARKETS.
 *
 * Gold's stored trades and learning stay in the database (never deleted);
 * they just aren't added to, shown or traded any more. To bring a market
 * back, put it in SIGNAL_MARKETS and take it out of RETIRED_MARKETS.
 */
export const SIGNAL_MARKETS = ["BTCUSD"] as const;
export type SignalMarket = (typeof SIGNAL_MARKETS)[number];

/** Markets that used to have signals and don't any more. */
export const RETIRED_MARKETS: ReadonlySet<string> = new Set(["XAUUSD"]);

export function isRetiredMarket(code: string | null | undefined): boolean {
  return !!code && RETIRED_MARKETS.has(code.toUpperCase());
}

/** What a member asking for gold is told. */
export const RETIRED_REPLY =
  "🥇 Gold's off the menu: OG B0T only calls Bitcoin now. Ask me for a ₿ BTC signal instead.";

/** Told to the AI when a member asks about gold, so it never makes up a gold call. */
export const RETIRED_BLOCK =
  "GOLD IS RETIRED: OG B0T no longer gives gold (XAU/USD) signals, levels, entries or market calls. " +
  "Say so in one friendly line and offer a Bitcoin signal instead. Never give gold prices, levels or a direction.";

/** For a database read: `.not("market", "in", RETIRED_IN)` leaves retired markets out. */
export const RETIRED_IN = `(${[...RETIRED_MARKETS].join(",")})`;
