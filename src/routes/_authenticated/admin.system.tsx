import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Bug, ClipboardCheck, FlaskConical, KeyRound, Map, Truck, Webhook } from "lucide-react";
import { TransferReadiness } from "@/components/admin/TransferReadiness";
import { ApiHub } from "@/components/admin/ApiHub";
import { E2ESmokeTest } from "@/components/admin/E2ESmokeTest";
import { TelegramSmokeTest } from "@/components/admin/TelegramSmokeTest";
import { FoulMouthSmokeTest } from "@/components/admin/FoulMouthSmokeTest";
import { HardwiredCapabilities } from "@/components/admin/HardwiredCapabilities";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { WebhooksAdminPage } from "./admin.webhooks";
import { RouteMapPage } from "./admin.route-map";
import { DebugContextPage } from "./admin.debug-context";
import { OnboardingWizard } from "./admin.onboarding";

export const Route = createFileRoute("/_authenticated/admin/system")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  component: AdminSystemHub,
});

/** One-click checks that used to be scattered across the old Overview desks. */
function Diagnostics() {
  return (
    <>
      <E2ESmokeTest />
      <TelegramSmokeTest />
      <FoulMouthSmokeTest />
      <HardwiredCapabilities />
    </>
  );
}

const TABS: readonly BossTab[] = [
  {
    value: "apis",
    label: "API keys",
    Icon: KeyRound,
    hint: "Every connected service with a live ping. Green means it answered.",
    Panel: ApiHub,
  },
  {
    value: "setup",
    label: "Setup checklist",
    Icon: ClipboardCheck,
    hint: "Step-by-step check that every connector and secret is in place.",
    Panel: OnboardingWizard,
  },
  {
    value: "tests",
    label: "Diagnostics",
    Icon: FlaskConical,
    hint: "Run a full app, Telegram or foul-mouth check when something feels off.",
    Panel: Diagnostics,
  },
  {
    value: "webhooks",
    label: "Payments webhook",
    Icon: Webhook,
    hint: "Stripe events as they arrive, and whether coins were credited.",
    Panel: WebhooksAdminPage,
  },
  {
    value: "routes",
    label: "Route map",
    Icon: Map,
    hint: "Every page in the app.",
    Panel: RouteMapPage,
  },
  {
    value: "debug",
    label: "Lyric debug",
    Icon: Bug,
    hint: "The extra context sent with recent lyric requests.",
    Panel: DebugContextPage,
  },
  {
    value: "transfer",
    label: "Transfer readiness",
    Icon: Truck,
    hint: "Checklist for moving the project to another account.",
    Panel: TransferReadiness,
  },
];

function AdminSystemHub() {
  const { isAdmin, isLoading } = useRole();

  if (isLoading) {
    return (
      <DashboardShell title="System">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="System">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
