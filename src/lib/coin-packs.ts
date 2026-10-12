// Single source of truth for purchasable coin packs and the VIP subscription.
// Used by both the client (Buy Coins page) and the server (checkout + webhook
// validation). Keep `priceId` in sync with payments--batch_create_product.

export interface CoinPack {
  bundleId: string;
  priceId: string;
  coins: number;
  priceCents: number;
  currency: "gbp";
  label: string;
  description: string;
  popular?: boolean;
  bestValue?: boolean;
  bonusCoins?: number;
}

export const CURRENCY_SYMBOL = "£";

// NOTE: Coins per pack are currently DOUBLED as a promo. The UI shows the
// pre-promo amount (coins / 2) crossed out next to the doubled amount.
export const COIN_PACKS: readonly CoinPack[] = [
  {
    bundleId: "coins_50",
    priceId: "coins_50_gbp",
    coins: 50,
    priceCents: 499,
    currency: "gbp",
    label: "Mini",
    description: "Just enough to try things out and play around.",
  },
  {
    bundleId: "coins_100",
    priceId: "coins_100_gbp",
    coins: 100,
    priceCents: 999,
    currency: "gbp",
    label: "Starter",
    description: "Casual chats and a handful of generations.",
  },
  {
    bundleId: "coins_240",
    priceId: "coins_240_gbp",
    coins: 240,
    priceCents: 1999,
    currency: "gbp",
    label: "Power",
    description: "The sweet spot for active creators.",
    popular: true,
  },
  {
    bundleId: "coins_600",
    priceId: "coins_600_gbp",
    coins: 600,
    priceCents: 3999,
    currency: "gbp",
    label: "Pro",
    description: "Serious sessions across Music Hub & Messenger.",
    bestValue: true,
  },
] as const;

/** Legacy bundle/price identifiers → current ones. Old Stripe sessions, stored
 *  selections and webhook replays still reference these, so keep resolving them. */
const LEGACY_BUNDLE_ALIASES: Record<string, string> = {
  coins_25: "coins_50",
  coins_120: "coins_240",
  coins_300: "coins_600",
};

const LEGACY_PRICE_ALIASES: Record<string, string> = {
  coins_25_gbp: "coins_50_gbp",
  coins_120_gbp: "coins_240_gbp",
  coins_300_gbp: "coins_600_gbp",
};

// Custom pack — 5 coins per £0.99 unit, configurable in the UI.
export const CUSTOM_COIN_UNIT = {
  coins: 5,
  priceCents: 99,
  minUnits: 1,
  maxUnits: 200, // up to 1000 coins / £198
} as const;

export interface VipPlan {
  bundleId: "og_vip_monthly" | "og_vip_yearly";
  priceId: "og_vip_monthly" | "og_vip_yearly";
  priceCents: number;
  currency: "gbp";
  label: string;
  /** Billing cadence label shown in UI. */
  cadence: "month" | "year";
}

export const VIP_PLAN: VipPlan = {
  bundleId: "og_vip_monthly",
  priceId: "og_vip_monthly",
  priceCents: 499,
  currency: "gbp",
  label: "OG VIP Monthly",
  cadence: "month",
};

export const VIP_PLAN_YEARLY: VipPlan = {
  bundleId: "og_vip_yearly",
  priceId: "og_vip_yearly",
  priceCents: 5000,
  currency: "gbp",
  label: "OG VIP Yearly",
  cadence: "year",
};

export type VipPlanKey = "monthly" | "yearly";
export function getVipPlan(plan: VipPlanKey | undefined): VipPlan {
  return plan === "yearly" ? VIP_PLAN_YEARLY : VIP_PLAN;
}

/** Bundles historically used for the VIP plan. Used by webhook/refund/reconcile
 *  paths so legacy purchases are still treated as VIP. */
const VIP_BUNDLE_IDS = new Set<string>([
  "vip_monthly",
  "vip_yearly",
  "og_vip_monthly",
  "og_vip_yearly",
]);

export function findCoinPackByPriceId(priceId: string): CoinPack | undefined {
  const id = LEGACY_PRICE_ALIASES[priceId] ?? priceId;
  return COIN_PACKS.find((p) => p.priceId === id);
}

export function findCoinPackByBundleId(bundleId: string): CoinPack | undefined {
  const id = LEGACY_BUNDLE_ALIASES[bundleId] ?? bundleId;
  return COIN_PACKS.find((p) => p.bundleId === id);
}

export function isVipBundle(bundleId: string | undefined): boolean {
  return !!bundleId && VIP_BUNDLE_IDS.has(bundleId);
}

// ---------- Admin-editable pack overrides (stored in site_content) ----------

/** Override blob persisted at site_content key `buyCoins.pack.<bundleId>`. */
export interface PackOverride {
  label?: string;
  description?: string;
  /** Override displayed + charged coin amount. Must be a positive integer. */
  coins?: number;
  /** Override displayed + charged price in pence. Must be a positive integer. */
  priceCents?: number;
  /** When false, hides the 2× bonus chip and the crossed-out "pre-promo" amount. */
  bonus?: boolean;
}

export function packOverrideKey(bundleId: string): string {
  return `buyCoins.pack.${bundleId}`;
}

export function parsePackOverride(raw: string | null | undefined): PackOverride {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: PackOverride = {};
    if (typeof v.label === "string" && v.label.trim()) out.label = v.label.trim().slice(0, 40);
    if (typeof v.description === "string") out.description = v.description.trim().slice(0, 240);
    if (Number.isInteger(v.coins) && v.coins > 0 && v.coins <= 1_000_000) out.coins = v.coins;
    if (Number.isInteger(v.priceCents) && v.priceCents > 0 && v.priceCents <= 1_000_000) {
      out.priceCents = v.priceCents;
    }
    if (typeof v.bonus === "boolean") out.bonus = v.bonus;
    return out;
  } catch {
    return {};
  }
}

/** Merge a stored override onto the canonical pack to produce the effective pack. */
export function applyPackOverride(pack: CoinPack, override: PackOverride): CoinPack {
  return {
    ...pack,
    label: override.label ?? pack.label,
    description: override.description ?? pack.description,
    coins: override.coins ?? pack.coins,
    priceCents: override.priceCents ?? pack.priceCents,
  };
}

/** Whether the 2× bonus visual should render for this pack. Default: on. */
export function packShowsBonus(override: PackOverride): boolean {
  return override.bonus !== false;
}
