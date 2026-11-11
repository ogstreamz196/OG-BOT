import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import ogCarromArt from "@/assets/og-carrom.webp";

/**
 * "Back to OG B0T" from OG CARROM, for players whose OG B0T account was made
 * from their carrom username: #t= is a one-time sign-in (in the fragment, so
 * it never reaches a server log). Signs them in and goes home.
 */
export const Route = createFileRoute("/carrom-return")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Welcome back | OG B0T" }, { name: "robots", content: "noindex" }],
  }),
  component: CarromReturn,
});

function CarromReturn() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const m = /(?:^#|&)t=([^&]+)/.exec(window.location.hash);
    // Take the token out of the address straight away.
    window.history.replaceState(null, "", window.location.pathname);
    let tokenHash: string | null = null;
    try {
      tokenHash = m ? decodeURIComponent(m[1]) : null;
    } catch {
      tokenHash = null;
    }
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!tokenHash) {
        if (data.session && !data.session.user.is_anonymous) return navigate({ to: "/" });
        return setFailed(true);
      }
      const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
      if (error) {
        // Used or expired; if they're already signed in that's fine.
        const { data: again } = await supabase.auth.getSession();
        if (again.session && !again.session.user.is_anonymous) return navigate({ to: "/" });
        return setFailed(true);
      }
      navigate({ to: "/" });
    })();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <img src={ogCarromArt} alt="" className="h-24 w-24 rounded-2xl object-cover" />
      {failed ? (
        <>
          <h1 className="text-2xl font-bold">That link has expired</h1>
          <p className="text-muted-foreground">
            Sign in with your username and password, or open OG B0T from OG CARROM again.
          </p>
          <Button asChild className="w-full">
            <Link to="/welcome">Go to OG B0T</Link>
          </Button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Signing you in to OG B0T…</p>
        </>
      )}
    </main>
  );
}
