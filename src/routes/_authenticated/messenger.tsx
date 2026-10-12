import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, MessageCircle, Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { OgChat } from "@/components/messenger/OgChat";
import { CommunityRoom } from "@/components/messenger/CommunityRoom";

import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useMessengerMode,
  useSetMessengerMode,
  type MessengerMode,
} from "@/hooks/use-messenger-mode";
import { useFoulMouth } from "@/hooks/use-foul-mouth";
import { useFillViewport } from "@/hooks/use-fill-viewport";
import { useAuth } from "@/hooks/use-auth";
import { modeHeading } from "@/lib/messenger-mode-labels";
import {
  MessengerWelcomeDialog,
  markGreeted,
  shouldGreet,
} from "@/components/messenger/MessengerWelcomeDialog";

import ogBotAsset from "@/assets/ogbot.png.asset.json";

export const Route = createFileRoute("/_authenticated/messenger")({
  component: MessengerPage,
  validateSearch: (search: Record<string, unknown>) => ({
    live: search.live === "1" || search.live === true ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "OG Bot · Loner Mode & OG Battle Zone" },
      {
        name: "description",
        content:
          "Chat privately in OG Bot Loner Mode, or enter the OG Battle Zone and roast-battle OG Bot.",
      },
    ],
  }),
});

function MessengerPage() {
  const { live: initialLive } = Route.useSearch();
  const { mode, isReady } = useMessengerMode();
  const setMode = useSetMessengerMode();
  const { foulMouth } = useFoulMouth();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [greetOpen, setGreetOpen] = useState(false);

  // One-time bootstrap: ?live=1 deep-link wins over saved pref on first load.
  useEffect(() => {
    if (!isReady) return;
    if (initialLive && mode !== "community") {
      setMode.mutate("community");
      markGreeted(uid);
      return;
    }
    if (shouldGreet(uid)) setGreetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  const isCommunity = mode === "community";
  const [pendingMode, setPendingMode] = useState<MessengerMode | null>(null);

  // Stepping into the OG Battle Zone is what starts the background soundtrack.
  useEffect(() => {
    if (!isReady || !isCommunity) return;
    window.dispatchEvent(new Event("og:background-music-enter-battle"));
  }, [isReady, isCommunity]);

  function handleGreetChoice(next: MessengerMode) {
    markGreeted(uid);
    if (next !== mode) {
      setMode.mutate(next, { onSettled: () => setGreetOpen(false) });
    } else {
      setGreetOpen(false);
    }
  }

  function handleGreetDismiss() {
    markGreeted(uid);
    setGreetOpen(false);
  }

  function requestSwitch() {
    setMode.mutate(isCommunity ? "loner" : "community");
  }

  function confirmSwitch() {
    if (pendingMode) setMode.mutate(pendingMode);
    setPendingMode(null);
  }

  const {
    ref: fillRef,
    height: fillHeight,
    pin: kbPin,
  } = useFillViewport<HTMLDivElement>(0);

  // While pinned above the keyboard, ancestors with transform/filter would
  // trap position:fixed inside them — neutralise those for the duration.
  useEffect(() => {
    if (!kbPin || !fillRef.current) return;
    const touched: Array<[HTMLElement, string, string, string, string]> = [];
    let el = fillRef.current.parentElement;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (
        cs.transform !== "none" ||
        cs.filter !== "none" ||
        (cs as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter !== "none" ||
        cs.perspective !== "none" ||
        /paint|layout|strict|content/.test(cs.contain) ||
        /transform|filter/.test(cs.willChange)
      ) {
        touched.push([el, el.style.transform, el.style.filter, el.style.animation, el.style.contain]);
        el.style.animation = "none";
        el.style.transform = "none";
        el.style.filter = "none";
        el.style.setProperty("backdrop-filter", "none");
        el.style.contain = "none";
      }
      el = el.parentElement;
    }
    return () => {
      for (const [n, t, f, a, c] of touched) {
        n.style.transform = t;
        n.style.filter = f;
        n.style.animation = a;
        n.style.contain = c;
        n.style.removeProperty("backdrop-filter");
      }
    };
  }, [kbPin, fillRef]);

  // Lock the outer page on the messenger so only the chat list scrolls and the
  // phone keyboard can't shove the header off the top of the screen.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow, html.style.overscrollBehavior];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    const pin = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", pin, { passive: true });
    window.visualViewport?.addEventListener("resize", pin);
    return () => {
      [html.style.overflow, body.style.overflow, html.style.overscrollBehavior] = prev as [
        string,
        string,
        string,
      ];
      window.removeEventListener("scroll", pin);
      window.visualViewport?.removeEventListener("resize", pin);
    };
  }, []);

  return (
    <DashboardShell title={modeHeading(mode)}>
      <div
        ref={fillRef}
        style={
          kbPin
            ? {
                position: "fixed",
                top: kbPin.top,
                left: 0,
                right: 0,
                height: kbPin.height,
                margin: 0,
                zIndex: 60,
              }
            : fillHeight
              ? { height: fillHeight }
              : undefined
        }
        className={`relative -mx-4 -mt-5 -mb-[calc(env(safe-area-inset-bottom)+72px+1.25rem)] flex flex-col overflow-hidden font-sans sm:-mx-6 sm:-mt-8 sm:-mb-[calc(env(safe-area-inset-bottom)+72px+2rem)] md:-mb-8 lg:-mx-8 lg:-mt-10 lg:-mb-10 ${kbPin ? "bg-background" : ""} ${foulMouth ? "hell-aura" : ""}`}
      >
        {foulMouth && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.35),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(220,38,38,0.3),transparent_65%)] animate-pulse"
            />
          </>
        )}
        <div
          className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden border-0 ${foulMouth ? "bg-gradient-to-b from-[#1a0505]/95 via-[#220808]/90 to-[#0d0202]/95" : "bg-card/60"}`}
        >
          {/* Header — adapts to current mode */}
          <header
            className={`relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 px-2.5 py-1.5 backdrop-blur-xl transition-colors sm:gap-3 sm:px-4 sm:py-2 ${
              isCommunity
                ? "bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-fuchsia-500/15"
                : "bg-gradient-to-r from-primary/15 via-card/90 to-card/80"
            }`}
          >
            <div className="relative shrink-0">
              <span
                aria-hidden
                className={`absolute -inset-1 rounded-full blur-md ${
                  isCommunity
                    ? "bg-gradient-to-br from-cyan-400/40 via-fuchsia-500/30 to-transparent"
                    : "bg-gradient-to-br from-primary/40 via-fuchsia-500/30 to-transparent"
                }`}
              />
              {isCommunity ? (
                <span className="relative grid h-8 w-8 place-items-center rounded-full bg-cyan-500/25 ring-1 ring-cyan-400/60 sm:h-9 sm:w-9">
                  <Users className="h-4 w-4 text-cyan-100 sm:h-5 sm:w-5" />
                </span>
              ) : (
                <img
                  src={ogBotAsset.url}
                  alt="OG Bot"
                  className="relative h-8 w-8 rounded-full object-cover ring-1 ring-primary/60 sm:h-9 sm:w-9"
                />
              )}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400 sm:h-3 sm:w-3" />
            </div>

            <div className="min-w-0 flex-1 basis-0">
              <h1 className="truncate text-[13px] font-extrabold leading-tight sm:text-base">
                {modeHeading(mode)}
              </h1>

              <p className="flex items-center gap-1 truncate text-[9px] font-medium text-emerald-400 sm:text-[11px]">
                <span className="relative inline-flex h-2 w-2 shrink-0">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
                  <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="truncate">
                  {isCommunity ? "Live battle · everyone can see" : "Private · only you can see"}
                </span>
              </p>
            </div>

            {/* Mode toggle — Loner ↔ Community. Switch label states what tapping will DO. */}
            <button
              type="button"
              onClick={requestSwitch}
              disabled={setMode.isPending || !isReady}
              role="switch"
              aria-checked={isCommunity}
              aria-label={
                isCommunity
                  ? "Go Private (leave the OG Battle Zone)"
                  : "Go to Battle Zone (leave Private Mode)"
              }
              className={`group flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border px-2 text-[9px] font-bold uppercase transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:h-9 sm:px-3 sm:text-[11px] ${
                isCommunity
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100 shadow-[0_0_24px_-6px_rgba(34,211,238,0.6)] hover:bg-cyan-500/25"
                  : "border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px_-6px_oklch(0.7_0.2_25/0.6)] hover:bg-primary/20"
              }`}
            >
              {isCommunity ? (
                <Users className="h-3.5 w-3.5 text-cyan-300" />
              ) : (
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
              )}
              <span className="whitespace-nowrap leading-tight">
                {setMode.isPending ? "Saving…" : isCommunity ? "Go Private" : "Go to Battle Zone"}
              </span>
            </button>
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {!isReady ? (
              <div
                role="status"
                aria-live="polite"
                aria-label="Loading your messenger preferences"
                className="flex h-full flex-col gap-3 p-4 sm:p-6"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading your messenger…
                </div>
                <Skeleton className="h-16 w-3/4 rounded-2xl" />
                <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
                <Skeleton className="h-20 w-5/6 rounded-2xl" />
                <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
                <div className="mt-auto">
                  <Skeleton className="h-12 w-full rounded-full" />
                </div>
              </div>
            ) : isCommunity ? (
              <CommunityRoom />
            ) : (
              <OgChat showHeader showQuickStarts />
            )}
            {setMode.isPending && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
              >
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-card/90 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shadow-lg backdrop-blur">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving mode…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <MessengerWelcomeDialog
        open={greetOpen}
        displayName={
          (user?.user_metadata?.display_name as string | undefined) ??
          (user?.user_metadata?.username as string | undefined) ??
          null
        }
        currentMode={mode}
        pending={setMode.isPending}
        onChoose={handleGreetChoice}
        onDismiss={handleGreetDismiss}
      />

      <AlertDialog open={pendingMode !== null} onOpenChange={(o) => !o && setPendingMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMode === "community"
                ? "Enter the OG Battle Zone?"
                : "Switch to OG Bot Loner Mode?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode === "community"
                ? "You'll leave your private chat and step into the OG Battle Zone — everyone vs OG Bot. Anything you send is visible to everyone."
                : "You'll leave the OG Battle Zone and return to a private 1-on-1 chat with OG Bot. Only you can see Loner Mode messages."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>
              {pendingMode === "community" ? "Yes, let's battle" : "Yes, back to Loner"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardShell>
  );
}
