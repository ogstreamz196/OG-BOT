import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Disc3,
  Coins,
  Settings,
  Shield,
  LogOut,
  Gift,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useVipSubscription } from "@/hooks/use-vip-subscription";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import ogStreamzLogo from "@/assets/ogstreamz-logo.jpg.asset.json";
import ogBotAsset from "@/assets/ogbot.png.asset.json";

type AppRoute =
  | "/"
  | "/library"
  | "/messenger"
  | "/store"
  | "/buy-coins"
  | "/settings"
  | "/developer"
  | "/admin"
  | "/profile"
  | "/referrals";
type NavItem = {
  title: string;
  url: AppRoute;
  icon?: LucideIcon;
  image?: string;
  badge?: string;
  accent?: string;
  spin?: boolean;
  adminOnly?: boolean;
};

const primaryNav: NavItem[] = [
  { title: "Home", url: "/", icon: Home, accent: "from-sky-400/30 to-indigo-500/30" },
  {
    title: "Music",
    url: "/library",
    icon: Disc3,
    badge: "Studio",
    accent: "from-fuchsia-500/40 to-amber-400/40",
    spin: true,
  },
  {
    title: "OG Bot",
    url: "/messenger",
    image: ogBotAsset.url,
    badge: "Live",
    accent: "from-primary/40 to-cyan-400/40",
  },
];

const accountNav: NavItem[] = [
  { title: "Profile", url: "/profile", icon: UserRound, accent: "from-cyan-400/30 to-blue-500/30" },
  { title: "Earnings", url: "/referrals", icon: Gift, accent: "from-pink-500/30 to-rose-400/30" },
  { title: "Store", url: "/store", icon: Coins, accent: "from-amber-400/40 to-yellow-300/40" },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    accent: "from-slate-400/25 to-zinc-400/25",
  },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile, isMobile, state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user } = useAuth();
  const dev = useDevMode();
  const { isAdmin, isTrial, trialEndsAt, hasVipRole } = useRole();
  const { data: vipSub } = useVipSubscription();
  const qc = useQueryClient();

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.replace("/welcome");
  };

  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(url + "/");

  const visible = (items: NavItem[]) =>
    items.filter((i) => (!i.adminOnly || isAdmin) && !(isAdmin && i.url === "/settings"));

  const renderItems = (items: NavItem[]) =>
    visible(items).map((item) => {
      const active = isActive(item.url);
      const Icon = item.icon;
      return (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton
            asChild
            isActive={active}
            tooltip={item.title}
            className={`group/nav font-display relative min-h-11 overflow-hidden rounded-xl border-2 px-2.5 py-1.5 text-[14px] leading-tight tracking-wide uppercase transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0.5 ${
              active
                ? "border-primary/50 bg-gradient-brand text-primary-foreground shadow-[0_6px_0_0_hsl(var(--primary)/0.4),0_14px_28px_-10px_hsl(var(--primary)/0.6)] hover:bg-gradient-brand active:shadow-[0_2px_0_0_hsl(var(--primary)/0.4)]"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:shadow-[0_4px_0_0_hsl(var(--primary)/0.25)] active:shadow-[0_1px_0_0_hsl(var(--primary)/0.2)]"
            }`}
          >
            <Link
              to={item.url}
              onClick={() => isMobile && setOpenMobile(false)}
              className="flex items-center gap-3"
            >
              {/* Animated accent sheen on hover */}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-r opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100 ${item.accent ?? "from-primary/20 to-transparent"}`}
              />
              {/* Icon tile */}
              <span
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-all duration-200 ${
                  active
                    ? "border-white/30 bg-white/15 shadow-[0_0_18px_-2px_hsl(var(--primary)/0.6)]"
                    : "border-white/10 bg-white/[0.04] group-hover/nav:border-primary/40 group-hover/nav:bg-white/10 group-hover/nav:shadow-[0_0_14px_-2px_hsl(var(--primary)/0.5)]"
                }`}
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.title}
                    draggable={false}
                    className="h-6 w-6 rounded-md object-cover transition-transform duration-300 group-hover/nav:scale-110 group-hover/nav:rotate-3 pointer-events-none select-none"
                  />
                ) : Icon ? (
                  <Icon
                    className={`h-5 w-5 transition-transform duration-300 group-hover/nav:scale-110 ${
                      item.spin ? "group-hover/nav:animate-spin" : "group-hover/nav:-rotate-6"
                    }`}
                  />
                ) : null}
              </span>
              <span className="relative z-10 min-w-0 flex-1 break-words">{item.title}</span>
              {item.badge && !collapsed && (
                <span
                  className={`relative z-10 font-display ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-[0_2px_0_0_hsl(var(--primary)/0.4)] ${
                    active ? "bg-white/25 text-primary-foreground" : "bg-primary/20 text-primary"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader
        className="border-b border-sidebar-border"
        style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))" }}
      >
        <div className="flex flex-col items-center gap-1 px-2 pb-3 text-center">
          <img
            src={ogStreamzLogo.url}
            alt="OG Streamz"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-white/10 shadow-glow pointer-events-none select-none"
          />
          {!collapsed && (
            <>
              <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-foreground">
                OG STREAMZ
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Powered by
                <img
                  src={ogBotAsset.url}
                  alt="OG Bot"
                  draggable={false}
                  className="h-3.5 w-3.5 rounded-full object-cover pointer-events-none select-none"
                />
                <span className="font-bold tracking-wider text-foreground/80">OG Bot</span>
              </span>
            </>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1 py-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">{renderItems(primaryNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">{renderItems(accountNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Boss Console</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin")}
                    tooltip="Admin"
                    className={`group/nav font-display relative min-h-11 overflow-hidden rounded-xl border-2 px-2.5 py-1.5 text-[14px] leading-tight tracking-wide uppercase transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0.5 ${
                      isActive("/admin")
                        ? "border-primary/50 bg-gradient-brand text-primary-foreground shadow-[0_6px_0_0_hsl(var(--primary)/0.4),0_14px_28px_-10px_hsl(var(--primary)/0.6)] hover:bg-gradient-brand active:shadow-[0_2px_0_0_hsl(var(--primary)/0.4)]"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:shadow-[0_4px_0_0_hsl(var(--primary)/0.25)] active:shadow-[0_1px_0_0_hsl(var(--primary)/0.2)]"
                    }`}
                  >
                    <Link
                      to="/admin"
                      onClick={() => isMobile && setOpenMobile(false)}
                      className="flex items-center gap-3"
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 -z-0 bg-gradient-to-r from-red-500/30 to-amber-400/30 opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100"
                      />
                      <span
                        className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-all duration-200 ${
                          isActive("/admin")
                            ? "border-white/30 bg-white/15 shadow-[0_0_18px_-2px_hsl(var(--primary)/0.6)]"
                            : "border-white/10 bg-white/[0.04] group-hover/nav:border-primary/40 group-hover/nav:bg-white/10"
                        }`}
                      >
                        <Shield className="h-5 w-5 transition-transform duration-300 group-hover/nav:scale-110 group-hover/nav:-rotate-6" />
                      </span>
                      <span className="relative z-10 min-w-0 flex-1 break-words">
                        Admin & Settings
                      </span>
                      {!collapsed && (
                        <Sparkles className="relative z-10 ml-auto h-4 w-4 text-amber-300 opacity-0 transition-opacity group-hover/nav:opacity-100" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && !isAdmin && (
          <VipTrialCountdown
            isTrial={isTrial}
            endsAt={trialEndsAt}
            paid={hasVipRole}
            paidEndsAt={vipSub?.currentPeriodEnd ?? null}
            paidRenews={!!vipSub && !vipSub.cancelAtPeriodEnd}
            onNavigate={() => isMobile && setOpenMobile(false)}
          />
        )}
        <div
          className="flex min-w-0 flex-col gap-2 px-2 pt-3"
          style={{ paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
        >
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold uppercase">
              {dev.isDev ? "D" : (user?.email?.[0] ?? "U")}
            </div>
            <span className="truncate">
              {dev.isDev ? "Dev mode" : (user?.email ?? "Signed in")}
            </span>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={handleSignOut}
            className="h-10 w-full justify-center gap-2 border-2 text-xs font-black uppercase"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function VipTrialCountdown({
  isTrial,
  endsAt,
  paid,
  paidEndsAt,
  paidRenews,
  onNavigate,
}: {
  isTrial: boolean;
  endsAt: string | null;
  paid: boolean;
  paidEndsAt: string | null;
  paidRenews: boolean;
  onNavigate: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const paidEnd = paidEndsAt ? new Date(paidEndsAt).getTime() - now : 0;
  if (paid) {
    const d = Math.floor(paidEnd / 86_400_000);
    const h = Math.floor((paidEnd % 86_400_000) / 3_600_000);
    const m = Math.floor((paidEnd % 3_600_000) / 60_000);
    return (
      <Link
        to="/buy-coins"
        onClick={onNavigate}
        className="mx-2 mt-2 block rounded-xl border border-coin/40 bg-coin/10 px-3 py-2 text-left transition hover:bg-coin/15"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-coin">
          <Crown className="h-3.5 w-3.5" /> OG VIP {paidRenews ? "renews in" : paidEndsAt ? "ends in" : "active"}
        </span>
        <span className="mt-0.5 block font-mono text-sm font-black tabular-nums text-foreground">
          {paidEnd > 0 ? `${d}d ${h}h ${m}m` : "Lifetime perks on"}
        </span>
      </Link>
    );
  }
  const ms = endsAt ? new Date(endsAt).getTime() - now : 0;
  const active = isTrial && ms > 0;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <Link
      to="/buy-coins"
      onClick={onNavigate}
      className="mx-2 mt-2 block rounded-xl border border-coin/40 bg-coin/10 px-3 py-2 text-left transition hover:bg-coin/15"
    >
      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-coin">
        <Crown className="h-3.5 w-3.5" />{" "}
        {active ? "Free VIP trial" : endsAt ? "VIP trial ended" : "Unlock OG VIP"}
      </span>
      {active ? (
        <span className="mt-0.5 block font-mono text-sm font-black tabular-nums text-foreground">
          {days}d {hours}h {mins}m left
        </span>
      ) : (
        <span className="mt-0.5 block text-xs font-semibold text-foreground">
          Tap to keep VIP perks
        </span>
      )}
    </Link>
  );
}
