// A member's own copier: access, whether it's running, and their pause.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { MyCopierPage } from "@/components/copier/MyCopierPage";

export const Route = createFileRoute("/_authenticated/copier")({
  // Website only: copy trading stays out of the phone apps (store rules).
  beforeLoad: () => {
    if (typeof window !== "undefined" && Capacitor.isNativePlatform()) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "My copier | OG B0T" }] }),
  component: MyCopierPage,
});
