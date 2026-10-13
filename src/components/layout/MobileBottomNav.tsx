import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Library, MessageCircle, ShoppingBag, Sparkles } from "lucide-react";
import { useEffect, type ComponentType } from "react";

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

function isTypingTarget(el: Element | null) {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement)
    return !["checkbox", "radio", "button", "submit", "range", "file"].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // While a phone keyboard is up, hide the bottom bar so typing areas can sit
  // flush above the keyboard instead of being squeezed behind it.
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    const root = document.documentElement;
    const sync = () => {
      const on = isTypingTarget(document.activeElement);
      if (on) root.dataset["kb"] = "1";
      else delete root.dataset["kb"];
      window.dispatchEvent(new Event("og:kb"));
    };
    const onOut = () => window.setTimeout(sync, 50);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", onOut);
      delete root.dataset["kb"];
    };
  }, []);

  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/85 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {TABS.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="contents">
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[9px] font-semibold uppercase transition-colors min-[380px]:px-2 min-[380px]:text-[10px] ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${active ? "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]" : ""}`}
                  aria-hidden
                />
                <span className="max-w-full text-center leading-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
