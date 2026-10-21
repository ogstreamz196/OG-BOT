import { Link, Navigate, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { ShieldCheck, ShieldAlert, Lock, Globe, ExternalLink, Map } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GuardKind = "public" | "auth" | "admin";

type RouteEntry = {
  path: string;
  file: string;
  guard: GuardKind;
  hasParam?: boolean;
  note?: string;
};

// Static manifest mirrors src/routes/. Kept in sync by the audit script
// (scripts/audit-routes.mjs) which fails CI if any path here is orphaned.
const ROUTES: RouteEntry[] = [
  { path: "/welcome", file: "welcome.tsx", guard: "public" },
  { path: "/auth", file: "auth.tsx", guard: "public" },
  { path: "/trust", file: "trust.tsx", guard: "public" },
  { path: "/m-preview", file: "m-preview.tsx", guard: "public" },
  {
    path: "/r/$code",
    file: "r.$code.tsx",
    guard: "public",
    hasParam: true,
    note: "Referral redirect",
  },
  { path: "/portal/$slug", file: "portal.$slug.tsx", guard: "public", hasParam: true },
  {
    path: "/track/$songId",
    file: "track.$songId.tsx",
    guard: "public",
    hasParam: true,
    note: "Public share page",
  },
  { path: "/styles/rap", file: "styles.rap.tsx", guard: "public" },
  { path: "/tg", file: "tg.tsx", guard: "public", note: "Telegram one-time sign-in" },
  {
    path: "/app-return",
    file: "app-return.tsx",
    guard: "public",
    note: "Native app sign-in return",
  },
  { path: "/auth/callback", file: "auth_.callback.tsx", guard: "public" },
  { path: "/sign-in-return", file: "sign-in-return.tsx", guard: "public" },
  { path: "/reset-password", file: "reset-password.tsx", guard: "public" },
  { path: "/delete-account", file: "delete-account.tsx", guard: "public" },
  { path: "/policy", file: "policy.tsx", guard: "public" },
  { path: "/terms", file: "terms.tsx", guard: "public" },
  { path: "/sports-guide", file: "sports-guide.tsx", guard: "public", note: "Redirect" },
  { path: "/dashboard", file: "dashboard.tsx", guard: "public", note: "Redirect" },
  { path: "/home", file: "home.tsx", guard: "public", note: "Redirect" },
  { path: "/login", file: "login.tsx", guard: "public", note: "Redirect" },
  { path: "/signin", file: "signin.tsx", guard: "public", note: "Redirect" },
  { path: "/signup", file: "signup.tsx", guard: "public", note: "Redirect" },
  {
    path: "/api/public/payments/webhook",
    file: "api/public/payments/webhook.ts",
    guard: "public",
    note: "RevenueCat webhook",
  },
  {
    path: "/api/public/telegram/webhook",
    file: "api/public/telegram/webhook.ts",
    guard: "public",
    note: "Telegram webhook (secret-verified)",
  },

  { path: "/", file: "_authenticated/index.tsx", guard: "auth" },
  { path: "/library", file: "_authenticated/library.index.lazy.tsx", guard: "auth" },
  {
    path: "/library/$songId",
    file: "_authenticated/library.$songId.tsx",
    guard: "auth",
    hasParam: true,
  },
  { path: "/buy-coins", file: "_authenticated/buy-coins.index.tsx", guard: "auth" },
  { path: "/buy-coins/return", file: "_authenticated/buy-coins.return.tsx", guard: "auth" },
  { path: "/messenger", file: "_authenticated/messenger.tsx", guard: "auth" },
  { path: "/community", file: "_authenticated/community.tsx", guard: "auth" },
  { path: "/portals", file: "_authenticated/portals.tsx", guard: "auth" },
  { path: "/referrals", file: "_authenticated/referrals.tsx", guard: "auth" },
  { path: "/settings", file: "_authenticated/settings.tsx", guard: "auth" },
  { path: "/store", file: "_authenticated/store.tsx", guard: "auth" },
  { path: "/sports", file: "_authenticated/sports.tsx", guard: "auth" },
  { path: "/profile", file: "_authenticated/profile.tsx", guard: "auth" },
  { path: "/purchase-history", file: "_authenticated/purchase-history.tsx", guard: "auth" },
  { path: "/change-password", file: "_authenticated/change-password.tsx", guard: "auth" },
  {
    path: "/developer",
    file: "_authenticated/developer.tsx",
    guard: "admin",
    note: "Redirects to /admin/bot (Live users)",
  },

  { path: "/admin", file: "_authenticated/admin.index.tsx", guard: "admin" },
  { path: "/admin/music", file: "_authenticated/admin.music.tsx", guard: "admin" },
  { path: "/admin/coins", file: "_authenticated/admin.coins.tsx", guard: "admin" },
  { path: "/admin/bot", file: "_authenticated/admin.bot.tsx", guard: "admin" },
  { path: "/admin/system", file: "_authenticated/admin.system.tsx", guard: "admin" },
  {
    path: "/admin/audit",
    file: "_authenticated/admin.audit.tsx",
    guard: "admin",
    note: "Redirects to Money / System",
  },
  {
    path: "/admin/store",
    file: "_authenticated/admin.store.tsx",
    guard: "admin",
    note: "Redirects to Money (Store)",
  },
  {
    path: "/admin/coin-audit",
    file: "_authenticated/admin.coin-audit.tsx",
    guard: "admin",
    note: "Redirects to Money (Coin check)",
  },
  {
    path: "/admin/webhooks",
    file: "_authenticated/admin.webhooks.tsx",
    guard: "admin",
    note: "Redirects to System (Payments webhook)",
  },
  { path: "/admin/api-keys", file: "_authenticated/admin.api-keys.tsx", guard: "admin" },
  { path: "/admin/debug-context", file: "_authenticated/admin.debug-context.tsx", guard: "admin" },
  {
    path: "/admin/og-persona",
    file: "_authenticated/admin.og-persona.tsx",
    guard: "admin",
    note: "Redirects to /admin/bot",
  },
  {
    path: "/admin/health",
    file: "_authenticated/admin.health.tsx",
    guard: "admin",
    note: "Automated API key health check",
  },
  {
    path: "/admin/onboarding",
    file: "_authenticated/admin.onboarding.tsx",
    guard: "admin",
    note: "Redirects to /admin/system (Setup checklist)",
  },
  {
    path: "/admin/referrals-audit",
    file: "_authenticated/admin.referrals-audit.tsx",
    guard: "admin",
  },
  { path: "/admin/route-map", file: "_authenticated/admin.route-map.tsx", guard: "admin" },
  {
    path: "/admin/user-settings",
    file: "_authenticated/admin.user-settings.tsx",
    guard: "admin",
    note: "Redirects to /admin/users",
  },
  { path: "/admin/users", file: "_authenticated/admin.users.tsx", guard: "admin" },
  { path: "/admin/users-pro", file: "_authenticated/admin.users-pro.tsx", guard: "admin" },
  {
    path: "/admin/users/$userId",
    file: "_authenticated/admin.users.$userId.tsx",
    guard: "admin",
    hasParam: true,
  },
];

const GUARD_META: Record<GuardKind, { label: string; tone: string; Icon: typeof Globe }> = {
  public: {
    label: "Public",
    tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    Icon: Globe,
  },
  auth: { label: "Signed-in", tone: "bg-sky-500/10 text-sky-300 border-sky-500/30", Icon: Lock },
  admin: {
    label: "Admin only",
    tone: "bg-red-500/10 text-red-300 border-red-500/30",
    Icon: ShieldCheck,
  },
};

export function RouteMapPage() {
  const { isAdmin, isLoading } = useRole();

  const grouped = useMemo(() => {
    const g: Record<GuardKind, RouteEntry[]> = { public: [], auth: [], admin: [] };
    for (const r of ROUTES) g[r.guard].push(r);
    return g;
  }, []);

  if (isLoading) {
    return (
      <DashboardShell title="Route map">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const total = ROUTES.length;
  const counts = {
    public: grouped.public.length,
    auth: grouped.auth.length,
    admin: grouped.admin.length,
  };

  return (
    <DashboardShell title="Route map">
      <div className="space-y-6">
        <header className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
              <Map className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {total} routes — {counts.public} public, {counts.auth} signed-in, {counts.admin}{" "}
                admin-only.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            CI guard: <code className="rounded bg-muted px-1.5 py-0.5">bun run audit:routes</code>
          </div>
        </header>

        {(["admin", "auth", "public"] as GuardKind[]).map((kind) => {
          const meta = GUARD_META[kind];
          const list = grouped[kind];
          if (!list.length) return null;
          return (
            <section key={kind} className="space-y-3">
              <div className="flex items-center gap-2">
                <meta.Icon className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  {meta.label} ({list.length})
                </h2>
              </div>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {list.map((r) => (
                  <li
                    key={r.path}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/30 px-4 py-3 transition hover:bg-card/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="truncate text-sm font-medium">{r.path}</code>
                        <Badge variant="outline" className={cn("text-[0.7rem]", meta.tone)}>
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.file}
                        {r.note ? ` · ${r.note}` : ""}
                      </p>
                    </div>
                    {r.hasParam || r.path.startsWith("/api/") ? (
                      <Button size="sm" variant="ghost" disabled className="gap-1.5 text-xs">
                        <ExternalLink className="h-3.5 w-3.5" /> needs params
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                        <Link to={r.path as never}>
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </DashboardShell>
  );
}
