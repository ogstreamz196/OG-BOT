import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Bell, HeartPulse, Radio, Sparkles } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { GeminiUsagePanel } from "@/components/admin/GeminiUsagePanel";
import { OgBotPing } from "@/components/admin/OgBotPing";
import { BossNotificationsPanel } from "@/components/admin/BossNotificationsPanel";
import { OgPersonaPanel } from "@/components/admin/OgPersonaPanel";
import { LiveUsersPanel } from "@/components/admin/LiveUsersPanel";

export const Route = createFileRoute("/_authenticated/admin/bot")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  // Signals and Telegram moved to their own Boss area (/admin/signals).
  beforeLoad: ({ search }) => {
    if (search.tab === "signals")
      throw redirect({ to: "/admin/signals", search: { tab: "controls" } });
    if (search.tab === "telegram")
      throw redirect({ to: "/admin/signals", search: { tab: "bots" } });
  },
  head: () => ({
    meta: [
      { title: "OG B0T | Boss" },
      { name: "description", content: "OG B0T's persona, health, your alerts and live users." },
      { property: "og:title", content: "OG B0T | Boss" },
      { property: "og:description", content: "OG B0T's persona, health, your alerts and live users." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
    value: "alerts",
    label: "Your alerts",
    Icon: Bell,
    hint: "Which events OG B0T sends to your Telegram.",
    Panel: BossNotificationsPanel,
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
