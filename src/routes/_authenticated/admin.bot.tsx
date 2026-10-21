import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Bell, HeartPulse, Radio, Send, Sparkles } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { GeminiUsagePanel } from "@/components/admin/GeminiUsagePanel";
import { OgBotPing } from "@/components/admin/OgBotPing";
import { TelegramWebhookStatus } from "@/components/admin/TelegramWebhookStatus";
import { BossNotificationsPanel } from "@/components/admin/BossNotificationsPanel";
import { OgPersonaPanel } from "@/components/admin/OgPersonaPanel";
import { LiveUsersPanel } from "@/components/admin/LiveUsersPanel";

export const Route = createFileRoute("/_authenticated/admin/bot")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  component: AdminBotPage,
});

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
    hint: "How OG Bot talks, plus the foul mouth switch.",
    Panel: OgPersonaPanel,
  },
  {
    value: "health",
    label: "Health & usage",
    Icon: HeartPulse,
    hint: "Is OG Bot answering, and how much paid AI it is using.",
    Panel: BotHealth,
  },
  {
    value: "telegram",
    label: "Telegram",
    Icon: Send,
    hint: "Whether Telegram messages are reaching the bot.",
    Panel: TelegramWebhookStatus,
  },
  {
    value: "alerts",
    label: "Your alerts",
    Icon: Bell,
    hint: "Which events OG Bot sends to your Telegram.",
    Panel: BossNotificationsPanel,
  },
  {
    value: "live",
    label: "Live users",
    Icon: Radio,
    hint: "Who is online right now. Pick someone to speak to them as OG Bot.",
    Panel: LiveUsersPanel,
  },
];

function AdminBotPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="OG Bot">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="OG Bot">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
