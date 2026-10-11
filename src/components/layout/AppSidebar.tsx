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
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
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
  const { isAdmin } = useRole();
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
            className={`group/nav font-display relative min-h-14 overflow-hidden rounded-2xl border-2 px-3 py-2 text-[15px] leading-tight tracking-wide uppercase transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0.5 ${
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
                className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all duration-200 ${
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
                    className="h-7 w-7 rounded-md object-cover transition-transform duration-300 group-hover/nav:scale-110 group-hover/nav:rotate-3 pointer-events-none select-none"
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
                  className={`relative z-10 font-display ml-auto rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider shadow-[0_2px_0_0_hsl(var(--primary)/0.4)] ${
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
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2.5">
          <img
            src={ogStreamzLogo.url}
            alt="OG Streamz"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/10 shadow-glow pointer-events-none select-none"
          />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="font-display truncate text-base tracking-tight">OG STREAMZ</span>
            <span className="mt-0.5 inline-flex items-center gap-1 truncate text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
              Powered by
              <img
                src={ogBotAsset.url}
                alt="OG Bot"
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="h-3.5 w-3.5 rounded-full object-cover pointer-events-none select-none"
              />
              <span className="font-bold tracking-wider text-foreground/80">OG Bot</span>
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(primaryNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(accountNav)}</SidebarMenu>
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
                    className={`group/nav font-display relative min-h-14 overflow-hidden rounded-2xl border-2 px-3 py-2 text-[15px] leading-tight tracking-wide uppercase transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0.5 ${
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
                        className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all duration-200 ${
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
        <div className="flex min-w-0 flex-col gap-2 px-2 py-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[0.7rem] font-bold uppercase">
              {dev.isDev ? "D" : (user?.email?.[0] ?? "U")}
            </div>
            <span className="truncate">
              {dev.isDev ? "Dev mode" : (user?.email ?? "Signed in")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-center gap-2 text-xs font-semibold"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
