import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Coins, Gift, Receipt, Scale, ShoppingBag, Tags, Users } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { OgCoinsPanel } from "@/components/admin/OgCoinsPanel";
import { MintCoinsPanel } from "@/components/admin/MintCoinsPanel";
import { PricingControls } from "@/components/admin/PricingControls";
import { AccountantLogPanel } from "@/components/admin/AccountantLogPanel";
import { StoreAdminPanel } from "./admin.store";
import { CoinAuditPage } from "./admin.coin-audit";
import { ReferralsAuditPage } from "./admin.referrals-audit";

export const Route = createFileRoute("/_authenticated/admin/coins")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
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
    value: "grant",
    label: "Grant coins",
    Icon: Gift,
    hint: "Give coins to a member. Every grant is in the Boss actions log (System).",
    Panel: MintCoinsPanel,
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
