import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/coin-audit")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coins", search: { tab: "coin-check" } });
  },
  component: () => null,
});
