import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, CheckCircle2, Coins, Loader2, MessageCircle, Send, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMyTelegramLinkToken, getMyTelegramStatus } from "@/lib/telegram-admin.functions";

const BOT = "OGStreamzBot";

const PERKS = [
  { icon: Bell, title: "Track ready alerts", text: "Get a ping the moment your song finishes." },
  {
    icon: Share2,
    title: "View & share tracks",
    text: "Type /tracks to see and share your latest songs.",
  },
  { icon: Coins, title: "Wallet on the go", text: "Check your balance and top up in one tap." },
  {
    icon: MessageCircle,
    title: "OG Bot in your pocket",
    text: "Chat with the same OG Bot brain anywhere.",
  },
];

export function TelegramConnectCard() {
  const statusFn = useServerFn(getMyTelegramStatus);
  const tokenFn = useServerFn(getMyTelegramLinkToken);
  const qc = useQueryClient();
  const launched = useRef(false);

  const status = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    staleTime: 30_000,
  });
  const linked = status.data?.state === "verified";

  // Pre-fetch the token so the button is a real link — phones block pop-ups opened after a wait.
  const token = useQuery({
    queryKey: ["my-telegram-token"],
    queryFn: () => tokenFn(),
    enabled: status.isSuccess && !linked,
    staleTime: Infinity,
  });
  const href = token.data?.token ? `https://t.me/${BOT}?start=${token.data.token}` : undefined;

  useEffect(() => {
    const onFocus = () => {
      if (!launched.current) return;
      launched.current = false;
      qc.invalidateQueries({ queryKey: ["my-telegram-status"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-5 shadow-card">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold leading-tight">OG Bot on Telegram</h2>
          {status.isLoading ? (
            <p className="text-xs text-muted-foreground">Checking connection…</p>
          ) : linked ? (
            <p className="flex items-center gap-1 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              {status.data?.username ? ` as @${status.data.username}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Not connected yet — takes 5 seconds.</p>
          )}
        </div>
      </div>

      <ul className="relative mt-4 grid gap-2 sm:grid-cols-2">
        {PERKS.map(({ icon: Icon, title, text }) => (
          <li
            key={title}
            className="flex gap-2.5 rounded-xl border border-border bg-background/40 p-3"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold leading-tight">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="relative mt-4">
        {linked ? (
          <Button asChild variant="outline" className="w-full">
            <a href={`https://t.me/${BOT}`} target="_blank" rel="noopener noreferrer">
              <Send className="mr-2 h-4 w-4" /> Open OG Bot
            </a>
          </Button>
        ) : (
          <>
            <Button asChild className="w-full" size="lg" disabled={!href}>
              <a
                href={href ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!href}
                onClick={(e) => {
                  if (!href) {
                    e.preventDefault();
                    return;
                  }
                  launched.current = true;
                  toast.message("Opening Telegram…", {
                    description: "Tap START to finish connecting.",
                  });
                }}
              >
                {href ? (
                  <Send className="mr-2 h-4 w-4" />
                ) : (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Connect Telegram
              </a>
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Opens Telegram on your device — just tap <b>START</b>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
