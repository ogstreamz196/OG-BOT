import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Coins, Receipt, Scale, ShoppingBag, Tags, Users, Webhook } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { OgCoinsPanel } from "@/components/admin/OgCoinsPanel";
import { WebhooksAdminPage } from "@/components/admin/WebhooksAdminPage";
import { PricingControls } from "@/components/admin/PricingControls";
import { AccountantLogPanel } from "@/components/admin/AccountantLogPanel";
import { StoreAdminPanel } from "@/components/admin/StoreAdminPanel";
import { CoinAuditPage } from "@/components/admin/CoinAuditPage";
import { ReferralsAuditPage } from "@/components/admin/ReferralsAuditPage";

export const Route = createFileRoute("/_authenticated/admin/coins")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  // Giving coins is done on the member's own page now (Members).
  beforeLoad: ({ search }) => {
    if (search.tab === "grant") throw redirect({ to: "/admin/users" });
  },
  component: AdminCoinsPage,
});

const TABS: readonly BossTab[] = [
  {
    value: "overview",
    label: "Overview",
    Icon: Coins,
    hint: "How many coins exist, who holds them and where they came from.",
    Panel: OgCoinsPanel,
  },
  {
    value: "prices",
    label: "Prices & limits",
    Icon: Tags,
    hint: "What members pay in coins. Only settings the app really charges are shown.",
    Panel: PricingControls,
  },
  {
    value: "store",
    label: "Store",
    Icon: ShoppingBag,
    hint: "OG Store categories, items, prices and stock.",
    Panel: StoreAdminPanel,
  },
  {
    value: "card",
    label: "Card payments",
    Icon: Receipt,
    hint: "Every card payment and refund, for your accounts.",
    Panel: AccountantLogPanel,
  },
  {
    value: "webhooks",
    label: "Stripe events",
    Icon: Webhook,
    hint: "Stripe events as they arrive, and whether coins were credited.",
    Panel: WebhooksAdminPage,
  },
  {
    value: "coin-check",
    label: "Coin check",
    Icon: Scale,
    hint: "Compares every balance with its coin history and flags mismatches.",
    Panel: CoinAuditPage,
  },
  {
    value: "referrals",
    label: "Referrals",
    Icon: Users,
    hint: "Referral codes, who invited whom and what leaders were paid.",
    Panel: ReferralsAuditPage,
  },
];

function AdminCoinsPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="Money">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="Money">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
