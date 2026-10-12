import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy link — the API & Integrations hub lives in System.
export const Route = createFileRoute("/_authenticated/admin/api-keys")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system" });
  },
  component: () => null,
});
