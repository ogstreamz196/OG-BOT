import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Library, MessageCircle, ShoppingBag, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

type Tab = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
};

const TABS: Tab[] = [
  { to: "/", label: "Home", icon: Home, match: (p) => p === "/" },
  { to: "/library", label: "Music", icon: Library, match: (p) => p.startsWith("/library") },
  {
    to: "/messenger",
    label: "OG Bot",
    icon: MessageCircle,
    match: (p) => p.startsWith("/messenger"),
  },
  {
    to: "/store",
    label: "Store",
    icon: ShoppingBag,
    match: (p) => p.startsWith("/store") || p.startsWith("/buy-coins"),
  },
  { to: "/referrals", label: "Earn", icon: Sparkles, match: (p) => p.startsWith("/referrals") },
];

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // px/pt only: a utility p-4 would override .safe-bottom (base layer) and
  // drop the home-indicator inset. --safe-pad keeps a 1rem minimum gap.
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-4 pt-4 [--safe-pad:1rem] md:hidden pointer-events-none">
      <nav
        aria-label="Primary"
        data-bottom-nav
        className="pointer-events-auto mx-auto max-w-sm rounded-3xl border border-white/10 glass-panel shadow-glow overflow-hidden"
      >
        <ul className="grid grid-cols-5">
          {TABS.map(({ to, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <li key={to} className="contents">
                <Link
                  to={to}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  className={`flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-bold uppercase transition-all duration-300 min-[380px]:px-2 min-[380px]:text-[10px] ${
                    active ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`h-6 w-6 transition-all duration-300 ${active ? "drop-shadow-[0_0_8px_hsl(var(--primary)/0.8)]" : ""}`}
                    aria-hidden
                  />
                  <span className="max-w-full text-center leading-tight">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
