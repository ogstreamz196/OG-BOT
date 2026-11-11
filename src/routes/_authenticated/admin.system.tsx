import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { ClipboardCheck, KeyRound, ToggleRight, Wrench } from "lucide-react";
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
import { BossAuditLog } from "@/components/admin/BossAuditLog";
import { FreeAccessPanel } from "@/components/admin/FreeAccessPanel";
import { RouteMapPage } from "@/components/admin/RouteMapPage";
import { DebugContextPage } from "@/components/admin/DebugContextPage";
import { OnboardingWizard } from "@/components/admin/OnboardingWizard";

export const Route = createFileRoute("/_authenticated/admin/system")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  // Old links follow what moved: the Stripe webhook to Money, and
  // Diagnostics and Boss actions into Tools & logs.
  beforeLoad: ({ search }) => {
    if (search.tab === "webhooks") {
      throw redirect({ to: "/admin/coins", search: { tab: "webhooks" } });
    }
    if (search.tab === "tests" || search.tab === "actions") {
      throw redirect({ to: "/admin/system", search: { tab: "tools" } });
    }
  },
  component: AdminSystemHub,
});

/**
 * Checks, the Boss log and the rarely needed tools, on one tab so the tab bar
 * stays short. Each panel is the same one it always was, just stacked.
 */
function ToolsAndLogs() {
  return (
    <div className="space-y-8">
      <ToolSection
        title="Diagnostics"
        desc="Run a full app, Telegram or foul-mouth check when something feels off."
      >
        <E2ESmokeTest />
        <TelegramSmokeTest />
        <FoulMouthSmokeTest />
        <HardwiredCapabilities />
      </ToolSection>
      <ToolSection title="Boss actions" desc="Everything done from Boss controls, newest first.">
        <BossAuditLog />
      </ToolSection>
      <ToolSection title="Route map" desc="Every page in the app.">
        <RouteMapPage />
      </ToolSection>
      <ToolSection title="Lyric debug" desc="The extra context sent with recent lyric requests.">
        <DebugContextPage />
      </ToolSection>
      <ToolSection
        title="Transfer readiness"
        desc="Checklist for moving the project to another account."
      >
        <TransferReadiness />
      </ToolSection>
    </div>
  );
}

function ToolSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h2 className="text-lg leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {children}
    </section>
  );
}

const TABS: readonly BossTab[] = [
  {
    value: "access",
    label: "Free access",
    Icon: ToggleRight,
    hint: "Switch VIP features on for everyone for a while.",
    Panel: FreeAccessPanel,
  },
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
    value: "tools",
    label: "Tools & logs",
    Icon: Wrench,
    hint: "Diagnostics, the Boss actions log, route map, lyric debug and transfer readiness.",
    Panel: ToolsAndLogs,
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
