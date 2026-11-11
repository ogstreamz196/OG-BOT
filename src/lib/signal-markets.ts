/**
 * The markets OG B0T gives signals on. Gold was retired (2026-11-02) and
 * brought back alongside Bitcoin (the Boss, 2026-11-07: gold was the winning
 * market, ~68% vs Bitcoin's ~43%). Everything that scans, learns, auto-trades
 * or lists markets reads SIGNAL_MARKETS.
 *
 * A retired market's stored trades and learning stay in the database (never
 * deleted). To retire one, take it out of SIGNAL_MARKETS and add it to
 * RETIRED_MARKETS; to bring it back, the reverse.
 */
export const SIGNAL_MARKETS = ["XAUUSD", "BTCUSD"] as const;
export type SignalMarket = (typeof SIGNAL_MARKETS)[number];

/** Markets that used to have signals and don't any more (none right now). */
export const RETIRED_MARKETS: ReadonlySet<string> = new Set<string>([]);

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

/**
 * For a database read: `.not("market", "in", RETIRED_IN)` leaves retired
 * markets out. With none retired it names a market that never exists, so the
 * filter is valid and excludes nothing.
 */
export const RETIRED_IN = RETIRED_MARKETS.size
  ? `(${[...RETIRED_MARKETS].join(",")})`
  : "(__none__)";
