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
    // The saved session (no network call): this runs on every navigation and
    // link hover. Every server function still verifies the token itself.
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user;
    // Guest (anonymous) sessions stay on the landing page's guest studio.
    if (error || !user || user.is_anonymous) throw redirect({ to: "/welcome" });
    return { user };
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
