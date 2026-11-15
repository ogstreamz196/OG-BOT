import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Coins, Receipt, Scale, Tags } from "lucide-react";
import { ToolSection } from "@/components/admin/ToolSection";
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
    // Seven tabs became four (the Boss, 2026-11-13): old links follow.
    const moved = OLD_TABS[search.tab ?? ""];
    if (moved) throw redirect({ to: "/admin/coins", search: { tab: moved } });
  },
  component: AdminCoinsPage,
});

/** Where each old Money tab lives now. */
const OLD_TABS: Record<string, string> = {
  store: "prices",
  card: "payments",
  webhooks: "payments",
  "coin-check": "checks",
  referrals: "checks",
};

function PricesAndStore() {
  return (
    <div className="space-y-8">
      <ToolSection
        title="Prices & limits"
        desc="What members pay in coins. Only settings the app really charges are shown."
      >
        <PricingControls />
      </ToolSection>
      <ToolSection title="Store" desc="OG Store categories, items, prices and stock.">
        <StoreAdminPanel />
      </ToolSection>
    </div>
  );
}

function Payments() {
  return (
    <div className="space-y-8">
      <ToolSection title="Card payments" desc="Every card payment and refund, for your accounts.">
        <AccountantLogPanel />
      </ToolSection>
      <ToolSection
        title="Stripe events"
        desc="Stripe events as they arrive, and whether coins were credited."
      >
        <WebhooksAdminPage />
      </ToolSection>
    </div>
  );
}

function Checks() {
  return (
    <div className="space-y-8">
      <ToolSection
        title="Coin check"
        desc="Compares every balance with its coin history and flags mismatches."
      >
        <CoinAuditPage />
      </ToolSection>
      <ToolSection
        title="Referrals"
        desc="Referral codes, who invited whom and what leaders were paid."
      >
        <ReferralsAuditPage />
      </ToolSection>
    </div>
  );
}

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
    label: "Prices & store",
    Icon: Tags,
    hint: "Coin prices and limits, and the OG Store's items and stock.",
    Panel: PricesAndStore,
  },
  {
    value: "payments",
    label: "Payments",
    Icon: Receipt,
    hint: "Card payments and refunds, and Stripe events as they arrive.",
    Panel: Payments,
  },
  {
    value: "checks",
    label: "Checks",
    Icon: Scale,
    hint: "The coin balance check and the referrals record.",
    Panel: Checks,
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
