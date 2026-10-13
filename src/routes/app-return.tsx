import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app-return")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in | OG BOT — AI Songs & Diss Tracks" },
      { name: "description", content: "Finishing sign-in and returning you to OG BOT." },
      { property: "og:title", content: "Signing you in — OG BOT" },
      { property: "og:description", content: "Finishing sign-in and returning you to OG BOT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppReturn,
});

export function AppReturn() {
  const [session, setSession] = useState<Session | null>(null);
  const [native, setNative] = useState(() => Capacitor.isNativePlatform());
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, currentSession) => {
      if (active && currentSession) {
        setSession(currentSession);
        setError("");
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setSession(data.session);
        setError("");
      } else setError("Sign-in did not finish. Please try again.");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const raw =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
  const next = raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  useEffect(() => {
    if (native && session) window.location.replace(next);
  }, [native, session, next]);

  // Prepare the intent before the tap. Chrome blocks app launches initiated after
  // an awaited session lookup; a real anchor click retains the user gesture.
  const appIntent =
    !native && session && typeof window !== "undefined"
      ? (() => {
          const url = new URL("https://ogbot.co.uk/app-return");
          url.searchParams.set("next", next);
          url.searchParams.set("access_token", session.access_token);
          url.searchParams.set("refresh_token", session.refresh_token);
          const fallback = encodeURIComponent(
            `${window.location.origin}/sign-in-return${window.location.search}`,
          );
          return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=uk.co.ogbot.app;S.browser_fallback_url=${fallback};end`;
        })()
      : null;

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-4">
        <p className="text-foreground">{session ? "Signed in to OG BOT" : "Finishing sign-in…"}</p>
        {appIntent && (
          <>
            <Button asChild size="lg" className="min-h-12 w-full">
              <a href={appIntent} onClick={() => setOpening(true)}>
                Open OG BOT app
              </a>
            </Button>
            {opening && (
              <p className="text-sm text-muted-foreground">
                If OG BOT does not open, check that the installed app supports sign-in return.
              </p>
            )}
            <a href={next} className="text-sm text-muted-foreground underline">
              Continue in browser
            </a>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {error && (
          <a href="/welcome" className="text-sm text-muted-foreground underline">
            Try signing in again
          </a>
        )}
      </div>
    </div>
  );
}
