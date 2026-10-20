import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getCarromAppLink } from "@/lib/carrom-link.functions";
import ogCarromArt from "@/assets/og-carrom.webp";

/**
 * "Sign in with OG BOT" from the OG CARROM phone app lands here in the
 * phone's browser. After the member taps Allow, the app opens again with a
 * pass that only that app can use (`c` is its challenge).
 */
export const Route = createFileRoute("/carrom-connect")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    c: typeof s.c === "string" && /^[A-Za-z0-9_-]{43}$/.test(s.c) ? s.c : "",
  }),
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.is_anonymous) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/welcome", search: { next } as never });
    }
  },
  head: () => ({
    meta: [{ title: "Connect OG CARROM | OG BOT" }, { name: "robots", content: "noindex" }],
  }),
  component: CarromConnect,
});

/** Refetch the pass if it's older than this (it lasts 5 minutes). */
const FRESH_MS = 3 * 60_000;

function CarromConnect() {
  const { c } = Route.useSearch();
  const linkFn = useServerFn(getCarromAppLink);
  const [link, setLink] = useState<{ url: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    if (!c) return;
    setError(null);
    try {
      const { url } = await linkFn({ data: { challenge: c } });
      setLink({ url, at: Date.now() });
    } catch {
      setError("Couldn't get that ready. Check your connection and try again.");
    }
  }, [c, linkFn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the pass fresh while the page sits open.
  useEffect(() => {
    if (!link) return;
    const t = window.setTimeout(() => void load(), FRESH_MS);
    return () => clearTimeout(t);
  }, [link, load]);

  if (!c) {
    return (
      <Shell title="Open this from OG CARROM">
        <p className="text-muted-foreground">
          This page connects the OG CARROM app to your OG BOT account. Open the app, go to your
          profile and tap "Sign in with OG BOT".
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/">Go to OG BOT</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Connect OG CARROM">
      <p className="text-muted-foreground">
        OG CARROM will use your OG BOT name so your carrom account is the same in the app and inside
        OG BOT. It only sees your name, never your email, and coins aren't shared.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {sent ? (
        <p className="text-sm text-muted-foreground">
          Back in OG CARROM? You can close this page. If the app didn't open, tap Allow again.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {link ? (
          // A real link (not a script redirect) so the phone lets it open the app.
          <Button asChild className="w-full font-bold">
            <a href={link.url} onClick={() => setSent(true)}>
              Allow and go back to OG CARROM
            </a>
          </Button>
        ) : error ? (
          <Button className="w-full" onClick={() => void load()}>
            Try again
          </Button>
        ) : (
          <Button disabled className="w-full">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Getting ready…
          </Button>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to="/">Not now</Link>
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <img src={ogCarromArt} alt="" className="mx-auto h-24 w-24 rounded-2xl object-cover" />
      <h1 className="text-center text-2xl font-bold">{title}</h1>
      {children}
    </main>
  );
}
