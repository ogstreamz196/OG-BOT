import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { ClipboardCheck, FlaskConical, History, KeyRound, ToggleRight, Wrench } from "lucide-react";
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
  // The Stripe webhook moved to Money; old links follow it.
  beforeLoad: ({ search }) => {
    if (search.tab === "webhooks") {
      throw redirect({ to: "/admin/coins", search: { tab: "webhooks" } });
    }
  },
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

/** Rarely needed tools, kept together so the tab bar stays short. */
function MoreTools() {
  return (
    <div className="space-y-8">
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
    value: "tests",
    label: "Diagnostics",
    Icon: FlaskConical,
    hint: "Run a full app, Telegram or foul-mouth check when something feels off.",
    Panel: Diagnostics,
  },
  {
    value: "actions",
    label: "Boss actions",
    Icon: History,
    hint: "Everything done from Boss controls, newest first.",
    Panel: BossAuditLog,
  },
  {
    value: "tools",
    label: "More tools",
    Icon: Wrench,
    hint: "Route map, lyric debug and transfer readiness.",
    Panel: MoreTools,
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
