import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/referrals-audit")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coins", search: { tab: "referrals" } });
  },
  component: () => null,
});
