import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Landing page for the bot's buttons (see src/lib/telegram-signin.server.ts):
 * trades the one-time token for a session on the Telegram-linked account, so
 * Telegram's in-app browser signs in instead of offering a fresh sign-up.
 */
export const Route = createFileRoute("/tg")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Opening OG BOT | OG BOT — AI Songs & Diss Tracks" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TelegramSignIn,
});

function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function TelegramSignIn() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("t");
    const next = safeNext();
    // Drop the token from the address bar and history straight away.
    window.history.replaceState(null, "", `/tg?next=${encodeURIComponent(next)}`);
    void (async () => {
      if (token) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
        if (!error) {
          window.location.replace(next);
          return;
        }
      }
      // Used or expired link: fine if this browser is already signed in.
      const { data } = await supabase.auth.getSession();
      if (data.session && !data.session.user.is_anonymous) {
        window.location.replace(next);
        return;
      }
      setFailed(true);
    })();
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-center text-foreground">
      {failed ? (
        <div className="max-w-sm space-y-4">
          <h1 className="font-display text-2xl font-black">This link has expired</h1>
          <p className="text-sm text-muted-foreground">
            Sign-in links from the bot work once and only for a short while. Go back to Telegram and
            tap the button in the bot's newest message, or sign in with your usual account below.
          </p>
          <a
            href={`/welcome?next=${encodeURIComponent(safeNext())}`}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-destructive px-6 text-sm font-black uppercase tracking-wide text-destructive-foreground"
          >
            Sign in
          </a>
          <p className="text-xs text-muted-foreground">
            Use the same email or username you already have. Making a new one starts a separate
            account.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening OG BOT…
        </div>
      )}
    </main>
  );
}
