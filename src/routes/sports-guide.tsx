import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address — keep working links pointing at the new page.
export const Route = createFileRoute("/sports-guide")({
  beforeLoad: () => {
    throw redirect({ to: "/sports" });
  },
});
