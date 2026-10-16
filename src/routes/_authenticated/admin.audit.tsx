import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The old Audit area was split up: money checks went to Money and the Boss
 * actions log went to System. Old links (including ?tab=) land in the right place.
 */
const MONEY_TABS: Record<string, string> = {
  card: "card",
  coins: "coin-check",
  referrals: "referrals",
};

export const Route = createFileRoute("/_authenticated/admin/audit")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  beforeLoad: ({ search }) => {
    if (search.tab === "actions") {
      throw redirect({ to: "/admin/system", search: { tab: "actions" } });
    }
    throw redirect({
      to: "/admin/coins",
      search: { tab: MONEY_TABS[search.tab ?? ""] ?? "card" },
    });
  },
  component: () => null,
});
