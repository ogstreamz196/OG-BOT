// Nasheed mode: a pure-vocal track. It costs double because the music engine
// is run twice (the track, then vocal separation on the first take), and
// only the separated acapella is delivered.

export const NASHEED_PRICE_MULTIPLIER = 2;
/** One full track by card, in pence (matches TRACK_UNLOCK_PENCE). */
const BASE_CARD_PENCE = 99;

/** True when "Nasheed" is one of the comma-separated styles. */
export function isNasheedStyle(style: string | null | undefined): boolean {
  return (style ?? "").split(",").some((s) => s.trim().toLowerCase() === "nasheed");
}

/** Coin price for a track, given the normal full-track price. */
export function trackCoinCost(baseCoins: number, nasheed: boolean): number {
  return nasheed ? baseCoins * NASHEED_PRICE_MULTIPLIER : baseCoins;
}

/** Quantity of the 99p full-track item in the card basket. */
export function trackCardQuantity(nasheed: boolean): number {
  return nasheed ? NASHEED_PRICE_MULTIPLIER : 1;
}

/** Card price shown to the user, e.g. "£0.99" or "£1.98". */
export function trackCardLabel(nasheed: boolean): string {
  return `£${((BASE_CARD_PENCE * trackCardQuantity(nasheed)) / 100).toFixed(2)}`;
}

/** Least a card payment must total for this track (pence). */
export function trackCardMinimumPence(nasheed: boolean, unitPence = BASE_CARD_PENCE): number {
  return unitPence * trackCardQuantity(nasheed);
}

/**
 * Whether a track is a Nasheed, read on its own so a database that doesn't
 * have the Nasheed columns yet (migration not applied) never breaks the
 * caller's main query: any error simply means "not a Nasheed".
 */
export async function songIsNasheed(
  client: { from: (t: string) => any },
  songId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("songs")
      .select("is_nasheed")
      .eq("id", songId)
      .maybeSingle();
    if (error) return false;
    return !!(data as { is_nasheed?: boolean } | null)?.is_nasheed;
  } catch {
    return false;
  }
}
