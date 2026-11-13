import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/developer")({
  // Live users now sits in Boss → OG Bot.
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "health" } });
  },
  component: () => null,
});
