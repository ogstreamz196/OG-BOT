import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Gift,
  Hourglass,
  Loader2,
  Sparkles,
  UserSearch,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BOSS_AREAS, BossNav } from "@/components/admin/BossNav";
import { BossKpiStrip, ProviderPulse } from "@/components/admin/BossOverview";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { isAdmin, isLoading: roleLoading } = useRole();

  if (roleLoading) {
    return (
      <DashboardShell title="Boss dashboard">
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <DashboardShell title="Boss dashboard">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />

        <div className="space-y-6">
          <section className="space-y-3">
            <SectionHeading title="Today" desc="Live numbers, refreshed every minute" />
            <BossKpiStrip />
            <ProviderPulse />
          </section>

          <NeedsAttention />

          <section className="space-y-3">
            <SectionHeading title="Quick actions" desc="The things you do most" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <QuickAction to="/admin/users" Icon={UserSearch} label="Find a member" />
              <QuickAction to="/admin/coins" tab="grant" Icon={Gift} label="Grant coins" />
              <QuickAction to="/admin/bot" tab="persona" Icon={Sparkles} label="0G B0T persona" />
              <QuickAction
                to="/admin/system"
                tab="tests"
                Icon={FlaskConical}
                label="Run diagnostics"
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading title="All Boss areas" desc="Each one has tabs inside" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BOSS_AREAS.filter((a) => a.to !== "/admin").map(
                ({ to, label, desc, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className="group flex min-h-[72px] min-w-0 items-center gap-3 rounded-xl border border-border bg-card/80 px-4 py-3 transition hover:border-primary/50 hover:bg-card"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-tight">{label}</span>
                      <span className="block text-xs text-muted-foreground">{desc}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </Link>
                ),
              )}
            </div>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}

function SectionHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-lg leading-tight sm:text-xl">{title}</h2>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function QuickAction({
  to,
  tab,
  Icon,
  label,
}: {
  to: "/admin/users" | "/admin/coins" | "/admin/bot" | "/admin/system";
  tab?: string;
  Icon: typeof Gift;
  label: string;
}) {
  return (
    <Link
      to={to}
      search={tab ? { tab } : {}}
      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card/80 px-2 py-3 text-center text-sm transition hover:border-primary/50 hover:bg-card"
    >
      <Icon className="h-5 w-5 text-primary" />
      <span className="leading-tight">{label}</span>
    </Link>
  );
}

const STUCK_MINUTES = 20;

/** Problems worth a look right now. Counts only; each row links to where it is fixed. */
function NeedsAttention() {
  const { data, isLoading } = useQuery({
    queryKey: ["boss", "needs-attention"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
      const [failed, stuck] = await Promise.all([
        supabase
          .from("songs")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed")
          .gte("created_at", dayAgo),
        supabase
          .from("songs")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "processing"])
          .lt("generation_started_at", stuckBefore),
      ]);
      return { failed: failed.count ?? 0, stuck: stuck.count ?? 0 };
    },
  });

  const items = [
    {
      key: "failed",
      count: data?.failed ?? 0,
      label: (n: number) => `${n} song${n === 1 ? "" : "s"} failed in the last 24 hours`,
      tab: "failures",
      Icon: AlertTriangle,
    },
    {
      key: "stuck",
      count: data?.stuck ?? 0,
      label: (n: number) =>
        `${n} song${n === 1 ? " has" : "s have"} been generating for over ${STUCK_MINUTES} minutes`,
      tab: "tracks",
      Icon: Hourglass,
    },
  ].filter((i) => i.count > 0);

  return (
    <section className="space-y-3">
      <SectionHeading title="Needs your attention" desc="Checked every minute" />
      <div className="overflow-hidden rounded-xl border border-border bg-card/80">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> All clear. Nothing needs you right
            now.
          </div>
        ) : (
          items.map(({ key, count, label, tab, Icon }, i) => (
            <Link
              key={key}
              to="/admin/music"
              search={{ tab }}
              className={cn(
                "flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-muted/30",
                i > 0 && "border-t border-border",
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1 text-sm">{label(count)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
