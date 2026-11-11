import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/webhooks")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coins", search: { tab: "webhooks" } });
  },
  component: () => null,
});
