import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/debug-context")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "tools" } });
  },
  component: () => null,
});
