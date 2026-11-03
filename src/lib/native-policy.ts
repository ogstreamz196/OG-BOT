// What stays out of the phone apps (the Boss's rule, 2026-11-03, for every
// app: "keep signals, the vault and anything that makes compliance difficult
// out of the Android build, without breaking the website"). The apps load the
// live site, so each feature checks for the app at runtime (useIsNativeApp /
// Capacitor.isNativePlatform) and hides itself there; the website is unchanged.
//
// Out of the apps:
// - Trading: OG Signals, signal cards, market calls, brokers, copy trading,
//   MT5 (Google Play financial-services and App Store rules).
// - OG VAULT / Vault Pass: IPTV logins and installing apps outside the store
//   (Play's device-and-network-abuse and unauthorised-streaming rules).
// - Paying for digital goods outside the store's own billing (Stripe):
//   in the apps every purchase goes through RevenueCat (Google Play Billing).

/** Store items that are never sold in the phone apps (by slug). */
export const NATIVE_HIDDEN_STORE_ITEMS = ["og-vip-pass"] as const;

/** Whether a store item is shown here (the website shows everything). Pure. */
export function storeItemAllowed(slug: string | null | undefined, native: boolean): boolean {
  if (!native) return true;
  return !(NATIVE_HIDDEN_STORE_ITEMS as readonly string[]).includes(slug ?? "");
}
