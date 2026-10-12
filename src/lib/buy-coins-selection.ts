import { CUSTOM_COIN_UNIT, findCoinPackByBundleId, type CoinPack } from "@/lib/coin-packs";

const SELECTION_STORAGE_KEY = "buyCoins.lastSelection";

export type StoredSelection =
  | { type: "coins"; bundleId: string }
  | { type: "custom"; units: number }
  | { type: "vip"; plan?: "monthly" | "yearly" };

export type Selection =
  | { type: "coins"; pack: CoinPack }
  | { type: "custom"; units: number }
  | { type: "vip"; plan?: "monthly" | "yearly" };

export function loadStoredSelection(): Selection | null {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSelection;
    if (parsed.type === "vip")
      return { type: "vip", plan: parsed.plan === "yearly" ? "yearly" : "monthly" };
    if (parsed.type === "coins") {
      const pack = findCoinPackByBundleId(parsed.bundleId);
      return pack ? { type: "coins", pack } : null;
    }
    if (parsed.type === "custom") {
      const u = Math.min(
        Math.max(parsed.units, CUSTOM_COIN_UNIT.minUnits),
        CUSTOM_COIN_UNIT.maxUnits,
      );
      return { type: "custom", units: u };
    }
    return null;
  } catch {
    return null;
  }
}

export function persistSelection(s: Selection): void {
  const stored: StoredSelection =
    s.type === "vip"
      ? { type: "vip", plan: s.plan ?? "monthly" }
      : s.type === "custom"
        ? { type: "custom", units: s.units }
        : { type: "coins", bundleId: s.pack.bundleId };
  try {
    sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export function clearStoredSelection(): void {
  try {
    sessionStorage.removeItem(SELECTION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
