import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/og-persona")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/bot", search: { tab: "persona" } });
  },
  component: () => null,
});
