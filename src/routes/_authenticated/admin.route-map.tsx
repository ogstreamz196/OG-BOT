import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/route-map")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system", search: { tab: "tools" } });
  },
  component: () => null,
});
