import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy link — health checks now live in System → API & Integrations.
export const Route = createFileRoute("/_authenticated/admin/health")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/system" });
  },
  component: () => null,
});
