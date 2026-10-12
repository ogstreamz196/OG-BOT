import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AlertTriangle, DoorOpen, Music2 } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { MusicDesk } from "@/components/admin/MusicDesk";
import { GenerationFailures } from "@/components/admin/GenerationFailures";
import { PortalManager } from "@/components/admin/PortalManager";

export const Route = createFileRoute("/_authenticated/admin/music")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  component: AdminMusicPage,
});

const TABS: readonly BossTab[] = [
  {
    value: "tracks",
    label: "Live tracks",
    Icon: Music2,
    hint: "Every song being made or recently finished. Retry, unlock or lock from here.",
    Panel: MusicDesk,
  },
  {
    value: "failures",
    label: "Failures",
    Icon: AlertTriangle,
    hint: "Songs that failed, grouped by reason, so you can spot a provider problem quickly.",
    Panel: GenerationFailures,
  },
  {
    value: "portals",
    label: "Portals",
    Icon: DoorOpen,
    hint: "Language and genre portals: open, close or put into maintenance.",
    Panel: PortalManager,
  },
];

function AdminMusicPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="Music">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="Music">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={TABS} />
      </div>
    </DashboardShell>
  );
}
