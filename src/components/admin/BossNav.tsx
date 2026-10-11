import { Link, useRouterState } from "@tanstack/react-router";
import {
  ShieldCheck,
  Globe2,
  Radio,
  Users,
  Scale,
  Activity,
  Store,
  Bot,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/admin", label: "Control Center", icon: ShieldCheck },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/system", label: "System", icon: Activity },
  { to: "/admin/audit", label: "Audit", icon: Scale },
  { to: "/admin/store", label: "Store", icon: Store },
  { to: "/admin/og-persona", label: "Persona", icon: Bot },
  { to: "/admin/onboarding", label: "Onboarding", icon: Rocket },
  { to: "/developer", label: "Live users", icon: Radio },
] as const;

/**
 * Sticky in-page nav for the Boss-only admin surface — the single place every
 * admin tool is reachable from, with the current page highlighted.
 */
export function BossNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="sticky top-16 z-10 mb-6 -mx-4 md:-mx-8">
      <div className="glass-panel-strong border-y border-primary/30 px-4 py-2.5 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-sm">
          <span className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-widest text-primary-foreground shadow-glow">
            <ShieldCheck className="h-3 w-3" /> Boss
          </span>
          {LINKS.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition",
                  active
                    ? "border-primary/50 bg-primary/20 text-primary"
                    : "border-border bg-card/60 text-foreground/80 hover:bg-card",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </Link>
            );
          })}
          <a
            href="/auth"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 font-medium text-foreground/80 transition hover:bg-card"
          >
            <Globe2 className="h-3.5 w-3.5" /> Public view
          </a>
        </div>
      </div>
    </div>
  );
}
