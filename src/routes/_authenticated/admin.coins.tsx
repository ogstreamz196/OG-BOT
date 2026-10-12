import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Coins, Gift, Tags } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { OgCoinsPanel } from "@/components/admin/OgCoinsPanel";
import { MintCoinsPanel } from "@/components/admin/MintCoinsPanel";
import { PricingControls } from "@/components/admin/PricingControls";

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
    hint: "Give coins to a member. Every grant is logged in Audit.",
    Panel: MintCoinsPanel,
  },
  {
    value: "prices",
    label: "Prices & limits",
    Icon: Tags,
    hint: "What members pay in coins. Only settings the app really charges are shown.",
    Panel: PricingControls,
  },
];

function AdminCoinsPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="Coins">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="Coins">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
