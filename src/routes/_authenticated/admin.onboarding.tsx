import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "setup" } });
  },
  component: () => null,
  head: () => ({ meta: [{ title: "Onboarding — Admin | OG BOT — AI Songs & Diss Tracks" }] }),
});
