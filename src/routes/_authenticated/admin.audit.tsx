import { createFileRoute, Navigate } from "@tanstack/react-router";
import { History, Receipt, Scale, Users } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { BossAuditLog } from "@/components/admin/BossAuditLog";
import { CoinAuditPage } from "./admin.coin-audit";
import { ReferralsAuditPage } from "./admin.referrals-audit";
import { AccountantLogPanel } from "@/components/admin/AccountantLogPanel";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  component: AdminAuditHub,
});

const TABS: readonly BossTab[] = [
  {
    value: "card",
    label: "Card payments",
    Icon: Receipt,
    hint: "Every card payment and refund, for your accounts.",
    Panel: AccountantLogPanel,
  },
  {
    value: "coins",
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
  {
    value: "actions",
    label: "Boss actions",
    Icon: History,
    hint: "Everything done from Boss controls, newest first.",
    Panel: BossAuditLog,
  },
];

function AdminAuditHub() {
  const { isAdmin, isLoading } = useRole();

  if (isLoading) {
    return (
      <DashboardShell title="Audit">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="Audit">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
