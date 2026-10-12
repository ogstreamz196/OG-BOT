import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in — OG BOT" },
      { name: "description", content: "Finishing sign-in to OG BOT." },
      { property: "og:title", content: "Signing you in — OG BOT" },
      { property: "og:description", content: "Finishing sign-in to OG BOT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  if (["", "/dashboard", "/home", "/welcome", "/login", "/auth", "/auth/callback"].includes(path))
    return "/";
  return raw;
}

function AuthCallback() {
  const [error, setError] = useState("");
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.location.replace(safeNext());
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) go();
    });
    (async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: ex } = await supabase.auth.exchangeCodeForSession(code);
        if (ex) console.warn(ex.message);
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) go();
      else
        window.setTimeout(async () => {
          const { data: again } = await supabase.auth.getSession();
          if (again.session) go();
          else setError("Sign-in did not finish. Please try again.");
        }, 2500);
    })();
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        {error ? (
          <>
            <p role="alert" className="text-destructive">
              {error}
            </p>
            <a href="/welcome" className="text-sm text-muted-foreground underline">
              Try signing in again
            </a>
          </>
        ) : (
          <p className="text-foreground">Signing you in to OG BOT…</p>
        )}
      </div>
    </div>
  );
}
