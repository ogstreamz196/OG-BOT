import { lazy, Suspense } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Bell, HeartPulse, LineChart, Radio, Send, Sparkles } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { GeminiUsagePanel } from "@/components/admin/GeminiUsagePanel";
import { OgBotPing } from "@/components/admin/OgBotPing";
import { TelegramWebhookStatus } from "@/components/admin/TelegramWebhookStatus";
import { TelegramFleetPanel } from "@/components/admin/TelegramFleetPanel";
import { TelegramGroupsPanel } from "@/components/admin/TelegramGroupsPanel";
import { BossNotificationsPanel } from "@/components/admin/BossNotificationsPanel";
import { OgPersonaPanel } from "@/components/admin/OgPersonaPanel";
import { LiveUsersPanel } from "@/components/admin/LiveUsersPanel";
import { SignalsPortalPanel } from "@/components/admin/SignalsPortalPanel";
import { SignalRecordPanel } from "@/components/admin/SignalRecordPanel";
import { SignalReportPanel } from "@/components/admin/SignalReportPanel";
import { Mt5Panel } from "@/components/admin/Mt5Panel";

export const Route = createFileRoute("/_authenticated/admin/bot")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  head: () => ({
    meta: [
      { title: "Telegram & Workers | OG B0T Boss" },
      { name: "description", content: "Manage OG B0T, Telegram chats and your worker fleet." },
      { property: "og:title", content: "Telegram & Workers | OG B0T Boss" },
      { property: "og:description", content: "Manage Telegram chats and worker bots securely." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminBotPage,
});

// The backtest pulls in the whole signal engine, so it loads only when opened.
const SignalsBacktestPanel = lazy(() =>
  import("@/components/admin/SignalsBacktestPanel").then((m) => ({
    default: m.SignalsBacktestPanel,
  })),
);

function SignalsTab() {
  return (
    <>
      <SignalRecordPanel />
      <SignalReportPanel />
      <Mt5Panel />
      <SignalsPortalPanel />
      <Suspense
        fallback={<div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>}
      >
        <SignalsBacktestPanel />
      </Suspense>
    </>
  );
}

function TelegramTab() {
  return (
    <>
      <TelegramWebhookStatus />
      <TelegramFleetPanel />
      <TelegramGroupsPanel />
    </>
  );
}

function BotHealth() {
  return (
    <>
      <OgBotPing />
      <GeminiUsagePanel />
    </>
  );
}

const TABS: readonly BossTab[] = [
  {
    value: "persona",
    label: "Persona",
    Icon: Sparkles,
    hint: "How OG B0T talks: script, voice and dictionary.",
    Panel: OgPersonaPanel,
  },
  {
    value: "health",
    label: "Health & usage",
    Icon: HeartPulse,
    hint: "Is OG B0T answering, and how much paid AI it is using.",
    Panel: BotHealth,
  },
  {
    value: "telegram",
    label: "Telegram",
    Icon: Send,
    hint: "Whether Telegram messages are reaching the bot, and the groups it runs with its worker bots.",
    Panel: TelegramTab,
  },
  {
    value: "alerts",
    label: "Your alerts",
    Icon: Bell,
    hint: "Which events OG B0T sends to your Telegram.",
    Panel: BossNotificationsPanel,
  },
  {
    value: "signals",
    label: "Signals",
    Icon: LineChart,
    hint: "Turn the OG Signals portal on or off, and test how signals would have done on past prices.",
    Panel: SignalsTab,
  },
  {
    value: "live",
    label: "Live users",
    Icon: Radio,
    hint: "Who is online right now. Pick someone to speak to them as OG B0T.",
    Panel: LiveUsersPanel,
  },
];

function AdminBotPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="OG B0T">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="OG B0T">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
