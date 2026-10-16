import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SignInTracker } from "@/components/auth/SignInTracker";
import { AccountChecklistModal } from "@/components/auth/AccountChecklistModal";
import { TrackReadyListener } from "@/components/library/TrackReadyListener";
import { RoyaltyCelebration } from "@/components/celebration/RoyaltyCelebration";

// Floating OG Bot widget removed site-wide. The full chat lives on /messenger.
// Sign-in telemetry is intentionally limited to account ID and timestamp.

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    // Guest (anonymous) sessions stay on the landing page's guest studio.
    if (error || !data.user || data.user.is_anonymous) throw redirect({ to: "/welcome" });
    return { user: data.user };
  },
  component: function AuthedLayout() {
    const { user } = Route.useRouteContext();
    return (
      <AppShell>
        <SignInTracker userId={user.id} />
        <AccountChecklistModal />
        <RoyaltyCelebration userId={user.id} />
        <TrackReadyListener userId={user.id} />
        <Outlet />
      </AppShell>
    );
  },
});
