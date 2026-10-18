import { createFileRoute, Navigate } from "@tanstack/react-router";

// Profile and Settings are one page now; old links and bookmarks land there.
export const Route = createFileRoute("/_authenticated/profile")({
  component: () => <Navigate to="/settings" replace />,
});
