import { createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PurchaseHistory } from "@/components/PurchaseHistory";
import { VipStatusCard } from "@/components/settings/VipStatusCard";

export const Route = createFileRoute("/_authenticated/purchase-history")({
  component: PurchaseHistoryPage,
});

function PurchaseHistoryPage() {
  return (
    <DashboardShell title="Purchase history">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <header className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Purchase history</h1>
            <p className="text-sm text-muted-foreground">
              Orders, coin packs, and PRO membership changes.
            </p>
          </div>
        </header>

        <VipStatusCard />
        <PurchaseHistory />
      </div>
    </DashboardShell>
  );
}
