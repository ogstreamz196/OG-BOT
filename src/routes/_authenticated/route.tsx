import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SignInTracker } from "@/components/auth/SignInTracker";
import { AccountChecklistModal } from "@/components/auth/AccountChecklistModal";
import { RoyaltyCelebration } from "@/components/celebration/RoyaltyCelebration";

// Floating OG Bot widget removed site-wide. The full chat lives on /messenger.
// Sign-in telemetry is intentionally limited to account ID and timestamp.

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/welcome" });
    return { user: data.user };
  },
  component: function AuthedLayout() {
    const { user } = Route.useRouteContext();
    return (
      <AppShell>
        <SignInTracker userId={user.id} />
        <AccountChecklistModal />
        <RoyaltyCelebration userId={user.id} />
        <Outlet />
      </AppShell>
    );
  },
});
