import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/store")({
  // The store editor now lives in Money.
  beforeLoad: () => {
    throw redirect({ to: "/admin/coins", search: { tab: "store" } });
  },
  component: () => null,
});
