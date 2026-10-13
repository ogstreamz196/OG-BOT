import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Music2,
  MessageSquareMore,
  Sparkles,
  Coins,
  ArrowRight,
  Plus,
  Wand2,
  Library,
  Headphones,
  CheckCircle2,
  Circle,
  Disc3,
  Mic2,
  Radio,
  Bot,
  Gift,
  Infinity as InfinityIcon,
  Share2,
  Send,
  Smartphone,
  Globe,
  ShieldCheck,
  Crown,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import musicHubHero from "@/assets/musichub-hero.jpg";
import sportsGuideLogo from "@/assets/og-bot-sports-guide.png.asset.json";

import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { useRecentSongs, type RecentSong } from "@/hooks/use-recent-songs";
import { useAdaptiveOverlay } from "@/hooks/use-adaptive-overlay";
import welcomeLogo from "@/assets/og-streamz-presentz-ogbot.png.asset.json";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PrimaryCard } from "@/components/home/PrimaryCard";
import { DodgyLogo } from "@/components/welcome/DodgyLogo";
import { DodgyText } from "@/components/welcome/DodgyText";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyTelegramStatus } from "@/lib/telegram-admin.functions";
import { isValidUsername } from "@/components/auth/UsernamePrompt";
import { DailyDrop } from "@/components/dashboard/DailyDrop";

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardHome,
  head: () => ({
    meta: [
      { title: "AI Music Studio — OG Streamz" },
      {
        name: "description",
        content:
          "Your OG Streamz studio: generate AI songs, chat with OG Bot, and manage your coin-powered creator economy.",
      },
      { property: "og:title", content: "AI Music Studio — OG Streamz" },
      {
        property: "og:description",
        content: "Generate AI songs, chat with OG Bot, and run your creator economy.",
      },
      { property: "og:url", content: "https://ogbot.co.uk/" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://ogbot.co.uk/" }],
  }),
});

type PromptIdea = { title: string; description: string; vibe: string };

const EXAMPLE_PROMPTS: PromptIdea[] = [
  {
    title: "Late night drive",
    description: "Synthwave with moody vocals and neon city energy.",
    vibe: "Synthwave",
  },
  {
    title: "Sunday hangover",
    description: "Lo-fi acoustic ballad about regretting last night.",
    vibe: "Lo-fi",
  },
  {
    title: "Gym warm-up",
    description: "Hard-hitting trap beat with chant-style hooks.",
    vibe: "Trap",
  },
  {
    title: "Festival anthem",
    description: "Big-room house drop, euphoric chorus, hands in the air.",
    vibe: "House",
  },
  {
    title: "Heartbreak letter",
    description: "Slow piano ballad with raw, emotional lyrics.",
    vibe: "Ballad",
  },
  {
    title: "Pirate radio cypher",
    description: "UK drill instrumental with sliding 808s and dark keys.",
    vibe: "Drill",
  },
];

function DashboardHome() {
  const { user } = useAuth();
  const dev = useDevMode();
  const { data: profile } = useProfile();
  const { isVip, hasVipRole } = useRole();
  const { data: recentSongs = [] } = useRecentSongs(user?.id);

  const displayName =
    profile?.display_name?.trim() ||
    user?.email?.split("@")[0] ||
    (dev.isDev ? "Developer" : "there");
  const balance = profile?.coin_balance ?? 0;
  const hasSongs = recentSongs.length > 0;
  const statusFn = useServerFn(getMyTelegramStatus);
  const tg = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    enabled: !!user,
    staleTime: 30_000,
  });
  const tgDone =
    tg.data?.state === "verified" || !!(tg.data as { linked?: boolean } | undefined)?.linked;
  const emailDone = !!user?.email && !user.email.toLowerCase().endsWith("@ogstreamz.app");
  const nameDone = isValidUsername(profile?.display_name ?? "");
  const profileDone = nameDone && emailDone && tgDone;
  // "Say hi" = any message from this user in web chat (stored on this device) or via Telegram.
  const [webHi, setWebHi] = useState(false);
  useEffect(() => {
    if (!user) return;
    const check = () => {
      try {
        const raw = localStorage.getItem(`og-messenger-thread-v3:${user.id}`);
        const arr = raw ? (JSON.parse(raw) as { role?: string }[]) : [];
        setWebHi(Array.isArray(arr) && arr.some((m) => m?.role === "user"));
      } catch {
        /* ignore */
      }
    };
    check();
    window.addEventListener("og-messenger:sync", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener("og-messenger:sync", check);
      window.removeEventListener("storage", check);
    };
  }, [user]);
  const tgHi = useQuery({
    queryKey: ["said-hi", user?.id],
    enabled: !!user && !webHi,
    queryFn: async () => {
      const { count } = await supabase
        .from("og_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("role", "user");
      return (count ?? 0) > 0;
    },
  });
  const saidHi = webHi || !!tgHi.data;
  const allStepsDone = profileDone && hasSongs && saidHi && isVip;
  const welcomeRef = useRef<HTMLElement | null>(null);
  const scrimOpacity = useAdaptiveOverlay(welcomeRef, { min: 0.55, max: 0.92 });

  return (
    <div className="flex w-full flex-col space-y-10 sm:space-y-12">
      {/* Welcome */}
      <section
        ref={welcomeRef}
        className="group/welcome relative flex flex-col gap-3 overflow-hidden rounded-[2rem] border-2 border-white/15 bg-card/55 p-4 shadow-[0_24px_60px_-20px_rgba(80,60,255,0.45)] backdrop-blur-2xl sm:rounded-[2.5rem] sm:p-12"
      >
        {/* Adaptive dark scrim */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-background transition-opacity duration-500"
          style={{ opacity: scrimOpacity }}
        />
        {/* Bottom-up readability gradient */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/95 via-background/70 to-background/30"
        />
        {/* Conic rotating halo */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-32 opacity-40 [background:conic-gradient(from_0deg,oklch(0.55_0.22_268/0.35),transparent_35%,oklch(0.7_0.22_25/0.3)_60%,transparent_85%,oklch(0.55_0.22_268/0.35))] animate-[spin_22s_linear_infinite] blur-3xl"
        />
        {/* Floating cartoon blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 top-8 h-40 w-40 rounded-full bg-primary/30 blur-2xl wc-blob"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-accent/30 blur-2xl wc-float-slow"
        />
        {/* Sparkle particles */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[
            { top: "12%", left: "8%", d: "0s", s: "h-2 w-2" },
            { top: "22%", left: "92%", d: "0.6s", s: "h-1.5 w-1.5" },
            { top: "68%", left: "14%", d: "1.2s", s: "h-1 w-1" },
            { top: "82%", left: "78%", d: "0.3s", s: "h-2 w-2" },
            { top: "44%", left: "55%", d: "1.8s", s: "h-1 w-1" },
          ].map((p, i) => (
            <span
              key={i}
              className={`absolute rounded-full bg-white/80 shadow-[0_0_12px_4px_rgba(255,255,255,0.45)] ${p.s} animate-[wc-pop_2.4s_ease-in-out_infinite]`}
              style={{ top: p.top, left: p.left, animationDelay: p.d }}
            />
          ))}
        </div>

        {/* Top studio status strip */}
        <div className="relative -mx-4 -mt-4 mb-2 flex justify-center border-b border-white/10 bg-white/[0.03] py-2 sm:-mx-12 sm:-mt-12 sm:mb-4">
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-black uppercase tracking-[0.22em] text-foreground/80 sm:text-sm">
            <Disc3 className="h-4 w-4 animate-[spin_4s_linear_infinite] text-primary" />
            OG Live Studio
          </span>
        </div>

        <div className="relative flex flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
          <div className="order-2 flex w-full flex-row flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:flex-row sm:items-center sm:text-lg">
            {hasVipRole ? (
              <Link
                to="/settings"
                aria-label="You are an OG VIP member"
                className="inline-flex items-center gap-2 rounded-full border-2 border-amber-300/80 bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 px-4 py-1.5 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_24px_rgba(251,191,36,0.6)] wc-bounce-soft sm:px-6 sm:py-2.5 sm:text-lg"
              >
                <Crown className="h-6 w-6 fill-current sm:h-7 sm:w-7" />
                {profile?.og_vip_id ?? "OG VIP"}
              </Link>
            ) : (
              <Link
                to="/store"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-white/10 sm:px-5 sm:py-2.5 sm:text-lg"
              >
                <Crown className="h-4 w-4 text-amber-300" /> Get VIP
              </Link>
            )}
            <Badge
              variant="outline"
              className="justify-center gap-1.5 rounded-full border-2 border-white/20 bg-white/5 px-3 py-1.5 text-xs sm:gap-2 sm:px-5 sm:py-2.5 sm:text-lg"
            >
              <Coins className="h-4 w-4 shrink-0 text-primary animate-[bounce_2s_ease-in-out_infinite] sm:h-6 sm:w-6" />
              <span className="truncate">{balance} OG coins</span>
            </Badge>
            {/* Live mini equalizer */}
            <span
              aria-hidden
              className="ml-1 hidden items-end gap-[3px] rounded-full border-2 border-white/15 bg-white/[0.04] px-3 py-2 sm:inline-flex"
            >
              <span className="inline-flex items-center gap-1.5 pr-2 text-xs font-bold uppercase tracking-[0.2em] text-foreground/70">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
              {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-gradient-to-t from-primary/60 to-primary"
                  style={{
                    height: `${h * 18}px`,
                    animation: `eqPulse 0.${(i % 5) + 4}s ease-in-out ${i * 0.08}s infinite alternate`,
                  }}
                />
              ))}
            </span>
          </div>
          <div className="order-1 w-full min-w-0 basis-full rounded-3xl bg-background/35 p-4 text-center backdrop-blur-md ring-2 ring-white/10 transition-transform duration-500 group-hover/welcome:-translate-y-1 sm:order-none sm:p-8">
            <p className="inline-flex items-center justify-center gap-2 text-xs uppercase tracking-[0.28em] text-muted-foreground sm:text-xl">
              <span className="inline-block animate-[wiggle_1.6s_ease-in-out_infinite] [transform-origin:70%_70%]">
                👋
              </span>
              <span className="relative">
                Welcome back
                <span
                  aria-hidden
                  className="absolute -bottom-1 left-0 h-[2px] w-full origin-left scale-x-0 bg-gradient-to-r from-primary via-accent to-primary animate-[shimmer_3s_ease-in-out_infinite] [animation:wc-pop_0.8s_0.3s_cubic-bezier(.34,1.56,.64,1)_forwards]"
                />
              </span>
            </p>
            <div className="mt-4 flex flex-col items-center gap-4 sm:mt-5 sm:gap-7">
              <DodgyLogo
                src={welcomeLogo.url}
                alt="OG Streamz Presentz OG Bot"
                size={420}
                maxDrift={80}
                dodgeRadius={160}
                imageClassName="rounded-3xl ring-1 ring-white/10 shadow-glow w-full max-w-[420px] sm:max-w-[520px] h-auto"
                className="mx-auto"
              />

              <DodgyText dodgeRadius={160} maxDrift={28} className="w-full">
                <h1 className="font-display flex min-w-0 flex-col items-center gap-1 text-[clamp(1.5rem,3.2vw+0.75rem,3.75rem)] font-black leading-[1.05] tracking-[-0.02em] text-foreground [text-shadow:0_4px_28px_rgba(0,0,0,0.75)] [overflow-wrap:anywhere] [text-wrap:balance] [font-variant-ligatures:none] sm:gap-2">
                  <span className="block wc-pop">Hello,</span>
                  <span className="paint-drip font-display block max-w-full pb-2 not-italic font-black uppercase tracking-tight text-gradient-red [overflow-wrap:anywhere] text-[clamp(1.5rem,2.6vw+0.75rem,3rem)]">
                    {displayName}
                  </span>
                </h1>
              </DodgyText>
            </div>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-[1.5] text-foreground [text-shadow:0_1px_12px_rgba(0,0,0,0.75)] sm:text-xl md:text-2xl">
              Dive into{" "}
              <span className="text-gradient-red font-black tracking-tight text-[0.92em]">
                MusicHub
              </span>{" "}
              to create tracks, or open{" "}
              <span className="text-gradient-red font-black tracking-tight text-[0.92em]">
                OG Streamz Messenger
              </span>{" "}
              to chat with{" "}
              <span className="relative inline-block text-gradient-red font-black tracking-tight text-[0.92em]">
                OG Bot
                <span aria-hidden className="ml-1 inline-flex gap-0.5 align-middle">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-[bounce_1.2s_ease-in-out_infinite] [animation-delay:0s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-[bounce_1.2s_ease-in-out_infinite] [animation-delay:0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-[bounce_1.2s_ease-in-out_infinite] [animation-delay:0.3s]" />
                </span>
              </span>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Daily free coin drop — one claim per day, with Refer to earn right below */}
      <div className="space-y-3">
        <DailyDrop />
        <Link
          to="/referrals"
          preload="intent"
          className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-primary-foreground shadow-glow transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Share2 className="h-5 w-5" /> Refer to earn coins
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Primary CTAs — MusicHub + OG Bot at the top */}

      <section className="space-y-3">
        {/* Phones: one full-width row per card so text never squeezes into
            a 100px column. sm and up: the three-column card grid. */}
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 sm:gap-5">
          <PrimaryCard
            to="/library"
            image={musicHubHero}
            imageAlt="Neon vinyl with equalizer bars"
            eyebrow="MusicHub"
            title="Create a song"
            body="Generate · Remix · Release"
            cta="Open MusicHub"
            hazard
          />
          <PrimaryCard
            to="/messenger"
            search={{ live: true }}
            image={ogBotAsset.url}
            imageAlt="OG Bot avatar"
            eyebrow="OG Bot"
            title="Enter Battle Zone"
            body="Everyone vs OG Bot. Throw your best roast."
            cta="Enter Battle Zone"
            variant="accent"
          />
          <PrimaryCard
            to="/sports"
            image={sportsGuideLogo.url}
            imageAlt="OG Sports Guide"
            eyebrow="Live fixtures"
            title="Sports Guide"
            body="Matches, fights & TV listings"
            cta="Open Sports Guide"
            variant="cinema"
          />
        </div>
      </section>

      {/* Ask OG Bot CTA removed per request */}

      {/* Continuity demo */}
      {/* <ContinuityDemo /> hidden per request */}

      {/* Quick actions */}
      <section>
        <h2 className="heading-plate mb-3 text-sm font-bold uppercase tracking-[0.18em] text-foreground sm:mb-4 sm:text-base sm:tracking-[0.24em]">
          ⚡ Quick actions
        </h2>
        <div className="grid grid-cols-4 gap-2 sm:gap-4">
          <QuickAction
            to="/library"
            icon={<Plus className="h-7 w-7" />}
            label="Create"
            tone="violet"
          />
          <QuickAction
            to="/messenger"
            icon={<Wand2 className="h-7 w-7" />}
            label="Ask OG"
            tone="pink"
          />
          <QuickAction
            to="/library"
            icon={<Library className="h-7 w-7" />}
            label="Music"
            tone="cyan"
          />
          <QuickAction
            to="/referrals"
            icon={<Gift className="h-7 w-7" />}
            label="Earn"
            tone="emerald"
          />
        </div>
      </section>

      {!allStepsDone && (
        <div className="grid grid-cols-1 gap-6">
          {/* Next steps */}
          <Card className="rounded-[2rem] border-2 border-white/15 shadow-[0_18px_50px_-20px_rgba(80,60,255,0.35)]">
            <CardHeader>
              <CardTitle className="font-display text-2xl font-black leading-[1.1] tracking-tight break-words sm:text-4xl md:text-5xl">
                Next steps
              </CardTitle>
              <CardDescription className="text-base sm:text-lg">
                Get the most out of OG Studio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChecklistItem
                done={profileDone}
                label="Complete your profile (username, email & Telegram)"
                to="/settings"
              />
              <ChecklistItem done={hasSongs} label="Create your first song" to="/library" />
              <ChecklistItem done={saidHi} label="Say hi in OG Bot" to="/messenger" />
              <ChecklistItem done={isVip} label="Unlock VIP perks" to="/buy-coins" />
            </CardContent>
          </Card>
        </div>
      )}

      <footer className="flex justify-center border-t border-white/10 pt-6">
        <Link
          to="/policy"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}

function AskOgCta() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [service, setService] = useState<"musichub" | "messenger">("musichub");

  const handleStart = () => {
    const text = prompt.trim();
    if (text && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          "og:pending-prompt",
          JSON.stringify({ service, text, at: Date.now() }),
        );
      } catch {
        // storage may be blocked (private mode)
      }
    }
    setOpen(false);
    navigate({ to: service === "musichub" ? "/library" : "/messenger" });
  };

  return (
    <section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-[2rem] border-2 border-primary/50 bg-gradient-to-r from-primary/25 via-accent/20 to-primary/25 p-6 text-left shadow-[0_24px_60px_-20px_rgba(80,60,255,0.55)] backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-primary hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-8"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/40 blur-3xl transition-transform duration-700 group-hover:scale-110"
            />
            <div className="relative flex items-center gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/30 ring-2 ring-primary/60 sm:h-16 sm:w-16">
                <Sparkles className="h-7 w-7 text-primary sm:h-8 sm:w-8" />
              </span>
              <div className="min-w-0">
                <div className="text-[0.7rem] font-bold uppercase tracking-[0.28em] text-primary">
                  Ask OG Bot
                </div>
                <h2 className="font-display mt-1 text-2xl font-black leading-tight sm:text-4xl">
                  Start any task — pick a service & go
                </h2>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                  Describe what you want. Send it to MusicHub or Messenger.
                </p>
              </div>
            </div>
            <span className="relative hidden shrink-0 items-center gap-2 rounded-full border border-primary/50 bg-background/70 px-5 py-3 text-sm font-bold text-primary shadow-glow sm:inline-flex">
              <Wand2 className="h-4 w-4" /> Open prompt
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-black">
              What do you want to do?
            </DialogTitle>
            <DialogDescription>
              Pick a service and tell OG Bot what to spin up. We'll drop you in with your prompt
              ready.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
              {(["musichub", "messenger"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setService(s)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors",
                    service === s
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "musichub" ? (
                    <Music2 className="h-4 w-4" />
                  ) : (
                    <MessageSquareMore className="h-4 w-4" />
                  )}
                  {s === "musichub" ? "MusicHub" : "Messenger"}
                </button>
              ))}
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                service === "musichub"
                  ? "e.g. Make a moody drill track about chasing the bag…"
                  : "e.g. Help me plan a release week for my new EP…"
              }
              rows={4}
              className="resize-none rounded-xl text-base"
            />
            <Button
              onClick={handleStart}
              size="lg"
              className="w-full gap-2 rounded-xl text-base font-bold"
            >
              <Send className="h-4 w-4" />
              Start in {service === "musichub" ? "MusicHub" : "Messenger"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ContinuityDemo() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border-2 border-white/15 bg-card/55 p-6 shadow-[0_18px_50px_-20px_rgba(80,60,255,0.35)] backdrop-blur-xl sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-accent/20 blur-3xl"
      />
      <div className="relative mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/20 ring-1 ring-primary/40">
          <InfinityIcon className="h-5 w-5 text-primary" />
        </span>
        <div>
          <div className="text-[0.7rem] font-bold uppercase tracking-[0.28em] text-primary">
            Continue the conversation
          </div>
          <h2 className="font-display text-xl font-black sm:text-2xl">
            One bot, one memory, every surface.
          </h2>
        </div>
      </div>
      <div className="relative grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <ChatBubbleCard
          channel="Web Messenger"
          icon={<Globe className="h-4 w-4" />}
          userMsg="Yo OG, I need a hook about late nights and big dreams."
          botMsg="On it — drill or trap? I'll draft 4 bars."
        />
        <div className="flex items-center justify-center text-primary sm:flex-col">
          <ArrowRight className="h-6 w-6 sm:hidden" />
          <ArrowRight className="hidden h-6 w-6 sm:block" />
          <span className="ml-2 text-[0.7rem] font-bold uppercase tracking-[0.22em] text-muted-foreground sm:ml-0 sm:mt-1">
            synced
          </span>
        </div>
        <ChatBubbleCard
          channel="MusicHub · Telegram"
          icon={<Smartphone className="h-4 w-4" />}
          userMsg="Drill. Make it dark."
          botMsg="Got it — using the late nights / big dreams hook from earlier. Generating now."
          highlight
        />
      </div>
      <p className="relative mt-5 text-center text-xs text-muted-foreground sm:text-sm">
        Every OG Bot — web, Messenger, Telegram, MusicHub — shares the same memory. Pick up exactly
        where you left off.
      </p>
    </section>
  );
}

function ChatBubbleCard({
  channel,
  icon,
  userMsg,
  botMsg,
  highlight = false,
}: {
  channel: string;
  icon: React.ReactNode;
  userMsg: string;
  botMsg: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-background/60 p-4 backdrop-blur",
        highlight
          ? "border-primary/50 shadow-[0_10px_30px_-15px_rgba(80,60,255,0.6)]"
          : "border-white/10",
      )}
    >
      <div className="flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        {icon} {channel}
      </div>
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/85 px-3 py-2 text-sm text-primary-foreground">
        {userMsg}
      </div>
      <div className="mr-auto flex max-w-[85%] items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/30 ring-1 ring-accent/50">
          <Bot className="h-3.5 w-3.5 text-accent-foreground" />
        </span>
        <div className="rounded-2xl rounded-tl-sm bg-white/[0.06] px-3 py-2 text-sm text-foreground ring-1 ring-white/10">
          {botMsg}
        </div>
      </div>
    </div>
  );
}

const QUICK_TONES = {
  violet: "from-violet-500/30 to-fuchsia-500/20 text-violet-200 ring-violet-400/40",
  cyan: "from-cyan-500/30 to-sky-500/20 text-cyan-200 ring-cyan-400/40",
  pink: "from-pink-500/30 to-rose-500/20 text-pink-200 ring-pink-400/40",
  amber: "from-amber-500/30 to-orange-500/20 text-amber-200 ring-amber-400/40",
  emerald: "from-emerald-500/30 to-teal-500/20 text-emerald-200 ring-emerald-400/40",
} as const;

function QuickAction({
  to,
  icon,
  label,
  tone,
}: {
  to: "/library" | "/messenger" | "/buy-coins" | "/referrals";
  icon: React.ReactNode;
  label: string;
  tone: keyof typeof QUICK_TONES;
}) {
  return (
    <Link
      to={to}
      className="group flex min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-card/85 px-1 py-3 text-center backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:bg-white/[0.08] hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-5"
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${QUICK_TONES[tone]} shadow-glow ring-1 transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6 sm:h-14 sm:w-14`}
      >
        {icon}
      </span>
      <span className="text-xs font-bold leading-tight [overflow-wrap:normal] sm:text-base">
        {label}
      </span>
    </Link>
  );
}

function PromptCard({ prompt }: { prompt: PromptIdea }) {
  return (
    <li>
      <Link
        to="/library"
        preload="intent"
        className="group flex h-full flex-col gap-2 rounded-2xl border-2 border-white/10 bg-white/[0.03] p-5 transition-all duration-200 hover:-translate-y-1 hover:rotate-[-0.5deg] hover:border-primary/50 hover:bg-white/[0.07] hover:shadow-glow"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xl font-bold text-foreground">{prompt.title}</p>
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-2 border-white/15 bg-white/[0.04] text-sm"
          >
            {prompt.vibe}
          </Badge>
        </div>
        <p className="text-lg leading-relaxed text-muted-foreground">{prompt.description}</p>
        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-base font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
          Use this prompt <ArrowRight className="h-5 w-5" />
        </span>
      </Link>
    </li>
  );
}

function RecentRow({ song }: { song: RecentSong }) {
  const title = song.title?.trim() || song.prompt?.slice(0, 60) || "Untitled";
  return (
    <li>
      <Link
        to="/library/$songId"
        params={{ songId: song.id }}
        className="group flex items-center gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-white/[0.04]"
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-brand-soft shadow-card">
          {song.cover_url ? (
            <img
              src={song.cover_url}
              alt=""
              loading="lazy"
              decoding="async"
              width={56}
              height={56}
              sizes="56px"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
            />
          ) : (
            <Headphones className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {new Date(song.created_at).toLocaleDateString()}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-white/10 bg-white/[0.04] text-sm capitalize"
        >
          {song.status}
        </Badge>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </Link>
    </li>
  );
}

function RecentSkeleton() {
  return (
    <ul className="divide-y divide-border/40">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-3">
          <div className="h-11 w-11 animate-pulse rounded-lg bg-white/5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-white/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyRecent() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-white/15 bg-gradient-brand-soft text-primary">
        <Music2 className="h-7 w-7" />
      </div>
      <div>
        <p className="text-base font-semibold">No songs yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate your first personalised track in Music Hub.
        </p>
      </div>
      <Link
        to="/library"
        className={cn(
          buttonVariants({ size: "lg", variant: "premium" }),
          "mt-2 rounded-full text-base",
        )}
      >
        Create a song
      </Link>
    </div>
  );
}

function ChecklistItem({
  done,
  label,
  to,
}: {
  done: boolean;
  label: string;
  to: "/library" | "/messenger" | "/settings" | "/buy-coins";
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md border border-transparent px-2 py-3 transition-colors hover:border-border hover:bg-muted/40"
    >
      {done ? (
        <CheckCircle2 className="h-6 w-6 text-primary" />
      ) : (
        <Circle className="h-6 w-6 text-muted-foreground" />
      )}
      <span className={"text-lg font-medium " + (done ? "text-muted-foreground line-through" : "")}>
        {label}
      </span>
      <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground" />
    </Link>
  );
}
