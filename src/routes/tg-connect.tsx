import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ogBotLogo } from "@/assets/ogbot-logo";
import { claimTelegramConnect } from "@/lib/telegram-connect.functions";

/**
 * The one-time link OG B0T sends in a Telegram private chat lands here
 * (/tg-connect#tc_…). The token is kept on this device while the member signs
 * in or creates an account, then their Telegram is linked to it.
 */
export const Route = createFileRoute("/tg-connect")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Connect Telegram | OG B0T" }, { name: "robots", content: "noindex" }],
  }),
  component: TgConnect,
});

const KEY = "ogbot.tgConnect.v1";
const TOKEN_RE = /^tc_[A-Za-z0-9_-]{43}$/;
const BOT_URL = "https://t.me/OGStreamzBot";

type State = "working" | "done" | "missing" | "expired" | "used" | "failed";

function readToken(): string | null {
  try {
    // The token comes in the #fragment (never sent to the server); keep it on
    // this device and take it out of the address bar.
    const fromLink = window.location.hash.slice(1);
    if (TOKEN_RE.test(fromLink)) {
      localStorage.setItem(KEY, fromLink);
      window.history.replaceState(null, "", "/tg-connect");
    }
    const kept = localStorage.getItem(KEY);
    return kept && TOKEN_RE.test(kept) ? kept : null;
  } catch {
    const fromLink = window.location.hash.slice(1);
    return TOKEN_RE.test(fromLink) ? fromLink : null;
  }
}

function forgetToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

function TgConnect() {
  const claim = useServerFn(claimTelegramConnect);
  const [state, setState] = useState<State>("working");

  const run = useCallback(async () => {
    setState("working");
    const token = readToken();
    if (!token) return setState("missing");
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.is_anonymous) {
      // Sign in or create an account first, then come straight back here.
      window.location.replace("/welcome?next=/tg-connect");
      return;
    }
    try {
      const result = await claim({ data: { token } });
      if (result.ok) {
        forgetToken();
        return setState("done");
      }
      if (result.reason === "signin") {
        window.location.replace("/welcome?next=/tg-connect");
        return;
      }
      if (result.reason === "failed") return setState("failed");
      forgetToken();
      setState(result.reason === "used" ? "used" : "expired");
    } catch {
      setState("failed");
    }
  }, [claim]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <img
        src={ogBotLogo.large}
        alt=""
        width={96}
        height={96}
        className="mx-auto h-24 w-24 rounded-2xl object-cover"
      />
      {state === "working" ? (
        <>
          <h1 className="text-center text-2xl font-bold">Connecting your Telegram</h1>
          <Button disabled className="w-full">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> One sec…
          </Button>
        </>
      ) : state === "done" ? (
        <>
          <h1 className="text-center text-2xl font-bold">Telegram connected ✅</h1>
          <p className="text-center text-muted-foreground">
            OG B0T knows who you are now. Get back in the group, or open your chat with OG B0T for
            your menu.
          </p>
          <Button asChild className="w-full font-bold">
            <a href={BOT_URL}>Open OG B0T in Telegram</a>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Go to OG B0T</Link>
          </Button>
        </>
      ) : state === "failed" ? (
        <>
          <h1 className="text-center text-2xl font-bold">That didn't go through</h1>
          <p className="text-center text-muted-foreground">Check your connection and try again.</p>
          <Button className="w-full" onClick={() => void run()}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-center text-2xl font-bold">
            {state === "used" ? "That link's been used" : "That link doesn't work any more"}
          </h1>
          <p className="text-center text-muted-foreground">
            {state === "missing"
              ? "Open this from the link OG B0T sent you in Telegram."
              : "Connect links work once, for 24 hours."}{" "}
            Send /start to OG B0T in Telegram for a fresh one.
          </p>
          <Button asChild className="w-full font-bold">
            <a href={BOT_URL}>Open OG B0T in Telegram</a>
          </Button>
        </>
      )}
    </main>
  );
}
