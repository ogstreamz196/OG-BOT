import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Bot, Code2, HeartPulse, ToggleRight, Wrench } from "lucide-react";
import { OgPersonaPanel } from "@/components/admin/OgPersonaPanel";
import { BossNotificationsPanel } from "@/components/admin/BossNotificationsPanel";
import { OgBotPing } from "@/components/admin/OgBotPing";
import { GeminiUsagePanel } from "@/components/admin/GeminiUsagePanel";
import { LiveUsersPanel } from "@/components/admin/LiveUsersPanel";
import { ToolSection } from "@/components/admin/ToolSection";
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
      throw redirect({ to: "/admin/coins", search: { tab: "payments" } });
    }
    if (search.tab === "tests" || search.tab === "actions") {
      throw redirect({ to: "/admin/system", search: { tab: "tools" } });
    }
    // API keys joined bot health and live users on the Health tab.
    if (search.tab === "apis") {
      throw redirect({ to: "/admin/system", search: { tab: "health" } });
    }
    // The setup checklist moved into the Developer tab.
    if (search.tab === "setup") {
      throw redirect({ to: "/admin/system", search: { tab: "developer" } });
    }
  },
  component: AdminSystemHub,
});

/** OG B0T itself (folded in from its own area, 2026-11-13): how it talks and what it tells you. */
function OgBot() {
  return (
    <div className="space-y-8">
      <ToolSection title="Persona" desc="How OG B0T talks: its script, voice and dictionary.">
        <OgPersonaPanel />
      </ToolSection>
      <ToolSection title="Your alerts" desc="Which events OG B0T messages you about on Telegram.">
        <BossNotificationsPanel />
      </ToolSection>
    </div>
  );
}

/** Is everything answering: the bot, its AI usage, who's online and every connected service. */
function Health() {
  return (
    <div className="space-y-8">
      <ToolSection title="Bot health & AI usage" desc="Is OG B0T answering, and what its AI costs.">
        <OgBotPing />
        <GeminiUsagePanel />
      </ToolSection>
      <ToolSection title="Live users" desc="Who's online now. You can speak to them as OG B0T.">
        <LiveUsersPanel />
      </ToolSection>
      <ToolSection
        title="API keys"
        desc="Every connected service with a live ping. Green means it answered."
      >
        <ApiHub />
      </ToolSection>
    </div>
  );
}

/** The checks to run when something feels off, and the log of what the Boss did. */
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
      </ToolSection>
      <ToolSection title="Boss actions" desc="Everything done from Boss controls, newest first.">
        <BossAuditLog />
      </ToolSection>
    </div>
  );
}

/**
 * The developer's corner (the Boss, 2026-11-13: keep these out of the daily
 * controls): one-off setup and the tools only needed when building or moving
 * the app. Each panel is the same one it always was.
 */
function Developer() {
  return (
    <div className="space-y-8">
      <ToolSection
        title="Setup checklist"
        desc="Step-by-step check that every connector and secret is in place."
      >
        <OnboardingWizard />
      </ToolSection>
      <ToolSection title="Built-in abilities" desc="What OG B0T can do without any switch.">
        <HardwiredCapabilities />
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

const TABS: readonly BossTab[] = [
  {
    value: "bot",
    label: "OG B0T",
    Icon: Bot,
    hint: "OG B0T's persona and the Telegram alerts it sends you.",
    Panel: OgBot,
  },
  {
    value: "health",
    label: "Health",
    Icon: HeartPulse,
    hint: "Bot health and AI usage, live users, and a live ping of every API key.",
    Panel: Health,
  },
  {
    value: "tools",
    label: "Tools & logs",
    Icon: Wrench,
    hint: "Diagnostics and the Boss actions log.",
    Panel: ToolsAndLogs,
  },
  {
    value: "developer",
    label: "Developer",
    Icon: Code2,
    hint: "One-off setup and build tools: the setup checklist, route map, lyric debug and transfer readiness.",
    Panel: Developer,
  },
  {
    // The switch itself is on the dashboard bar; this is the full version
    // (a custom end time), opened from "All free access settings" there.
    value: "access",
    label: "Free access",
    Icon: ToggleRight,
    hint: "Switch VIP features on for everyone for a while.",
    Panel: FreeAccessPanel,
    hidden: true,
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
