import type { ReactNode } from "react";
import { useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { Search, ShieldCheck, LogOut, Crown, MoreVertical } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SwipeToOpenSidebar } from "@/components/layout/SwipeToOpenSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  AdminEditModeProvider,
  AdminEditModeToggle,
  useAdminEditMode,
} from "@/components/admin/AdminEditMode";
import { CoinBalance } from "@/components/dashboard/CoinBalance";
import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import { useRole } from "@/hooks/use-role";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "./AppSidebar";
import { VipTrialWelcome } from "./VipTrialWelcome";
import { HighContrastToggle } from "./HighContrastToggle";
import { WelcomeBackdrop } from "./WelcomeBackdrop";
import { MobileBottomNav } from "./MobileBottomNav";
import { GlobalMiniPlayer } from "@/components/GlobalMiniPlayer";
import { BackgroundMusicHeaderControl } from "@/components/PersistentBackgroundMusic";

import ogStreamzLogo from "@/assets/ogstreamz-logo.jpg.asset.json";
import ogBotLogo from "@/assets/ogbot.png.asset.json";

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 shadow-sm backdrop-blur-md"
      aria-label="OG Streamz powered by OG Bot"
    >
      <img
        src={ogStreamzLogo.url}
        alt="OG Streamz"
        className={`${compact ? "h-6" : "h-7"} w-auto rounded-md object-contain`}
      />
      <span className="whitespace-nowrap text-[8px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-tight">
        Powered by
      </span>
      <img
        src={ogBotLogo.url}
        alt="OG Bot"
        className={`${compact ? "h-6 w-6" : "h-7 w-7"} rounded-full object-cover ring-1 ring-primary/40`}
      />
    </div>
  );
}

const routeTitles: Record<string, string> = {
  "/": "Home",
  "/library": "Music",
  "/messenger": "OG Bot",
  "/buy-coins": "Buy Coins",
  "/settings": "Settings",
  "/profile": "Profile",
  "/admin": "Admin Controls",
};

function getRouteTitle(pathname: string) {
  const match = Object.keys(routeTitles)
    .filter((path) =>
      path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];
  return match ? routeTitles[match] : "PORTAL";
}

function AdminEditHint() {
  const { enabled } = useAdminEditMode();
  if (!enabled) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
      <ShieldCheck className="h-3.5 w-3.5" />
      Edit mode is on.
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = getRouteTitle(pathname);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const dev = useDevMode();
  const { isAdmin, isVip, isLoading: roleLoading } = useRole();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/welcome", replace: true });
  }

  return (
    <AdminEditModeProvider>
      <SidebarProvider>
        <WelcomeBackdrop />
        <SwipeToOpenSidebar />
        <div className="relative flex min-h-dvh w-full bg-background/80 text-foreground">
          <AppSidebar />
          <VipTrialWelcome />

          <div className="flex min-w-0 flex-1 flex-col">
            <header
              className="sticky top-0 z-30 grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/8 bg-background/70 backdrop-blur-xl sm:min-h-16 sm:gap-3"
              style={{
                paddingTop: "env(safe-area-inset-top)",
                paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
                paddingRight: "max(0.75rem, env(safe-area-inset-right))",
              }}
            >
              <SidebarTrigger
                aria-label="Open menu"
                className="h-11 w-auto shrink-0 gap-1.5 rounded-xl border-2 border-primary/50 bg-primary/10 px-3 text-sm font-black uppercase tracking-wider text-foreground hover:bg-primary/20 [&_svg]:!h-5 [&_svg]:!w-5"
              >
                Menu
              </SidebarTrigger>

              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                {!pathname.startsWith("/messenger") && (
                  <div className="hidden min-[480px]:block">
                    <BrandLockup compact />
                  </div>
                )}
                <div className="hidden min-w-0 sm:block">
                  <h1 className="font-display truncate text-base font-black leading-tight tracking-tight text-gradient-brand sm:text-xl lg:text-2xl">
                    {title}
                  </h1>
                </div>
                <div className="relative ml-2 hidden w-full max-w-xs lg:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search songs"
                    className="h-9 border-white/10 bg-white/5 pl-9"
                    onChange={(event) => {
                      window.dispatchEvent(
                        new CustomEvent("sonix:search", { detail: event.target.value }),
                      );
                    }}
                  />
                </div>
              </div>

              <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-2">
                <BackgroundMusicHeaderControl />
                {!roleLoading && isAdmin && (
                  <div className="hidden items-center gap-1.5 rounded-full border border-primary/40 bg-gradient-brand px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-glow md:flex">
                    <ShieldCheck className="h-3 w-3" />
                    Boss
                  </div>
                )}
                {!roleLoading && isVip && (
                  <Link
                    to="/settings"
                    title="VIP membership — manage subscription"
                    className="hidden items-center gap-1.5 rounded-full border border-primary/40 bg-gradient-brand px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-glow hover:opacity-90 md:flex"
                  >
                    <Crown className="h-3 w-3" />
                    VIP
                  </Link>
                )}
                <AdminEditModeToggle className="hidden md:inline-flex" />
                <HighContrastToggle className="hidden sm:inline-flex" />
                <CoinBalance className="order-first sm:order-none" />

                {/* Standalone sign-out on ≥380px */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  title={
                    dev.isDev
                      ? "Sign out (Dev mode)"
                      : `Sign out${user?.email ? ` ${user.email}` : ""}`
                  }
                  className="hidden h-9 w-9 hover:bg-white/5 min-[380px]:inline-flex"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="sr-only">Sign out</span>
                </Button>

                {/* Overflow menu for ultra-narrow widths (<380px) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 hover:bg-white/5 min-[380px]:hidden"
                      aria-label="More actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56"
                    onCloseAutoFocus={(event) => {
                      // Radix returns focus to the trigger by default. If the
                      // trigger is hidden (viewport widened past the min-[380px]
                      // breakpoint while the menu was open) fall back to the
                      // Coin Balance pill so keyboard/screen-reader users keep
                      // context in the header.
                      const trigger = document.querySelector<HTMLElement>(
                        "[aria-label='More actions']",
                      );
                      const triggerVisible = !!trigger && trigger.offsetParent !== null;
                      if (!triggerVisible) {
                        const pill = document.querySelector<HTMLElement>(
                          "[data-coin-balance-pill]",
                        );
                        if (pill) {
                          event.preventDefault();
                          pill.focus();
                        }
                      }
                    }}
                  >
                    <DropdownMenuLabel className="truncate">
                      {user?.email ?? "Account"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {!roleLoading && isAdmin && (
                      <DropdownMenuItem asChild>
                        <Link to="/admin">
                          <ShieldCheck className="mr-2 h-4 w-4" /> Boss controls
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {!roleLoading && isVip && (
                      <DropdownMenuItem asChild>
                        <Link to="/settings">
                          <Crown className="mr-2 h-4 w-4" /> VIP membership
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem asChild>
                      <Link to="/buy-coins">Buy coins</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/settings">Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {!roleLoading && isAdmin && !pathname.startsWith("/messenger") && (
              <div className="flex items-center justify-center gap-1.5 border-b border-primary/30 bg-primary/10 px-4 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary md:hidden">
                <ShieldCheck className="h-3 w-3" />
                Boss mode
              </div>
            )}
            <AdminEditHint />

            <main className="safe-x min-w-0 flex-1 overflow-x-hidden pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-0">
              <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
                {children}
              </div>
            </main>

            <GlobalMiniPlayer />
            <MobileBottomNav />
          </div>
        </div>
      </SidebarProvider>
    </AdminEditModeProvider>
  );
}
