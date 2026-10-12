import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Coins,
  Globe2,
  LayoutDashboard,
  Music2,
  Radio,
  Scale,
  Settings2,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every Boss area, in one place. The dashboard cards and the tab bar both read
 * from this list so the two never drift apart.
 */
export const BOSS_AREAS = [
  {
    to: "/admin",
    label: "Dashboard",
    desc: "Today's numbers and anything that needs you",
    icon: LayoutDashboard,
    group: "run",
  },
  {
    to: "/admin/users",
    label: "Users",
    desc: "Find people, change coins, VIP and roles",
    icon: Users,
    group: "run",
  },
  {
    to: "/admin/music",
    label: "Music",
    desc: "Live tracks, failed jobs and portals",
    icon: Music2,
    group: "run",
  },
  {
    to: "/admin/coins",
    label: "Coins",
    desc: "Coins in circulation, grant coins, prices",
    icon: Coins,
    group: "run",
  },
  {
    to: "/admin/store",
    label: "Store",
    desc: "Products, prices and stock",
    icon: Store,
    group: "run",
  },
  {
    to: "/admin/bot",
    label: "OG Bot",
    desc: "Persona, foul mouth, Telegram and alerts",
    icon: Bot,
    group: "bot",
  },
  {
    to: "/admin/audit",
    label: "Audit",
    desc: "Card payments, coin and referral checks, Boss actions",
    icon: Scale,
    group: "check",
  },
  {
    to: "/admin/system",
    label: "System",
    desc: "API keys, setup checklist, tests and debugging",
    icon: Settings2,
    group: "check",
  },
  {
    to: "/developer",
    label: "Live users",
    desc: "Who is online right now",
    icon: Radio,
    group: "check",
  },
] as const;

export type BossArea = (typeof BOSS_AREAS)[number];

function isActive(pathname: string, to: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (to === "/admin") return path === "/admin";
  return path === to || path.startsWith(`${to}/`);
}

/**
 * Boss header + tab bar shared by every admin page. Areas are grouped
 * (run the app · OG Bot · checks) with a divider between groups.
 */
export function BossNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = BOSS_AREAS.find((a) => isActive(pathname, a.to));

  return (
    <div className="boss-ui mb-5 space-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1 leading-none">
          <p className="truncate text-xl font-bold uppercase tracking-wide">
            Boss{current && current.to !== "/admin" ? ` · ${current.label}` : ""}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {current?.desc ?? "Control panel"}
          </p>
        </div>
        <a
          href="/auth"
          target="_blank"
          rel="noreferrer"
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground sm:inline-flex"
        >
          <Globe2 className="h-3.5 w-3.5" /> Public view
        </a>
      </div>
      <nav
        aria-label="Boss areas"
        className="sticky top-16 z-10 rounded-xl border border-border bg-card/95 backdrop-blur"
      >
        <div className="flex items-stretch overflow-x-auto whitespace-nowrap px-1 text-sm [scrollbar-width:none]">
          {BOSS_AREAS.map(({ to, label, icon: Icon, group }, i) => {
            const active = isActive(pathname, to);
            const newGroup = i > 0 && BOSS_AREAS[i - 1].group !== group;
            return (
              <span key={to} className="flex items-stretch">
                {newGroup && <span aria-hidden className="my-2.5 w-px shrink-0 bg-border" />}
                <Link
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-3 transition",
                    active
                      ? "border-primary font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </Link>
              </span>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
