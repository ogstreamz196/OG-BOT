/**
 * Member badges (the Boss, 2026-11-15): the paid subscription is OG B0T PRO
 * (it used to be called VIP; the role, tables and Stripe ids still say "vip").
 * Someone who owns both PRO and the OG Vault pass is a REAL OG. Pure.
 */
export type MemberBadge = "REAL OG" | "PRO";

export function memberBadge(m: { pro: boolean; vaultPass: boolean }): MemberBadge | null {
  if (m.pro && m.vaultPass) return "REAL OG";
  return m.pro ? "PRO" : null;
}
