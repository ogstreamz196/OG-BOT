import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * OG B0T was folded into System (the Boss, 2026-11-13: fewer areas to search
 * through). Persona and your alerts are System → OG B0T; health, AI usage and
 * live users are System → Health. Signals and Telegram moved to /admin/signals
 * earlier. Old links (including ?tab=) land in the right place.
 */
const MOVED: Record<string, { to: "/admin/system" | "/admin/signals"; tab: string }> = {
  persona: { to: "/admin/system", tab: "bot" },
  alerts: { to: "/admin/system", tab: "bot" },
  health: { to: "/admin/system", tab: "health" },
  live: { to: "/admin/system", tab: "health" },
  signals: { to: "/admin/signals", tab: "controls" },
  telegram: { to: "/admin/signals", tab: "bots" },
};

export const Route = createFileRoute("/_authenticated/admin/bot")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  beforeLoad: ({ search }) => {
    const m = MOVED[search.tab ?? ""] ?? MOVED.persona;
    throw redirect({ to: m.to, search: { tab: m.tab } });
  },
  component: () => null,
});
