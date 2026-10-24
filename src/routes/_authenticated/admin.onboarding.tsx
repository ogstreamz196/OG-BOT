import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "setup" } });
  },
  component: () => null,
  head: () => ({ meta: [{ title: "Onboarding — Admin | 0G B0T — AI Songs & Diss Tracks" }] }),
});
