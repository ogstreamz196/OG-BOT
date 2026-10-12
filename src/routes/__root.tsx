import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { ensureCurrentUserBootstrap } from "@/lib/user-bootstrap.functions";
import { getDeviceId } from "@/lib/device-id";
import { useSiteContentRealtime } from "@/hooks/use-site-content";
import { DisplayPrefsBridge } from "@/hooks/use-display-prefs";
import { AuraBridge } from "@/hooks/use-aura";
import { SingleAudioBridge } from "@/components/SingleAudioBridge";
import { InstallAppPrompt } from "@/components/InstallAppPrompt";
import { UserActivityArchiver } from "@/hooks/use-user-activity-archiver";
import { PersistentBackgroundMusic } from "@/components/PersistentBackgroundMusic";
import { TrackUnlockReturnHandler } from "@/components/library/TrackUnlockReturnHandler";
import { NativeAppLinkBridge } from "@/components/NativeAppLinkBridge";
import { RevenueCatBridge } from "@/components/revenuecat/RevenueCatBridge";
import { registerAppServiceWorker } from "@/lib/register-sw";
import { TrackReadyNotifier } from "@/components/TrackReadyNotifier";

function NotFoundComponent() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold text-gradient-brand">404</h1>
        <p className="mt-3 text-muted-foreground">This page doesn't exist.</p>
        <a
          href="/"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or head home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm font-medium">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "format-detection", content: "telephone=no" },
      { title: "OG Streamz — AI Song Generator & OG Bot Hub" },
      {
        name: "description",
        content:
          "OG Streamz turns a prompt into a full song with AI, with a built-in OG Bot assistant and a coin-powered creator economy.",
      },
      { name: "author", content: "OG Streamz" },
      { property: "og:site_name", content: "OG Streamz" },
      { property: "og:title", content: "OG Streamz — AI Song Generator & OG Bot Hub" },
      {
        property: "og:description",
        content:
          "Generate full songs from a prompt, chat with OG Bot, and run your creator economy in one place.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://ogbot.co.uk" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OG Streamz — AI Song Generator & OG Bot Hub" },
      {
        name: "twitter:description",
        content:
          "Generate full songs from a prompt, chat with OG Bot, and run your creator economy in one place.",
      },
      { name: "google-site-verification", content: "R34IxND5szTYrevWfX0gTnIvDi64kPx6wI0XCNM08YE" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Warm the image origin used for song cover thumbnails so they decode
      // without stalling the animated hero on first paint.
      {
        rel: "preconnect",
        href: "https://khjoyiqxupykicqnvhlc.supabase.co",
        crossOrigin: "anonymous",
      },
      { rel: "dns-prefetch", href: "https://khjoyiqxupykicqnvhlc.supabase.co" },
      // High-priority preload of the Google Fonts CSS so @font-face entries
      // are discovered before any text paints (cuts FOUT/FOIT noticeably).
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Archivo+Black&family=Barlow:wght@400;500;600;700&family=Bebas+Neue&family=Hind:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Bitcount+Grid+Double:wght@400;700;900&family=Bowlby+One&family=Bungee&family=Lilita+One&family=Unbounded:wght@400;500;600;700;800&family=Luckiest+Guy&family=Cabin+Sketch:wght@400;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Archivo+Black&family=Barlow:wght@400;500;600;700&family=Bebas+Neue&family=Hind:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Bitcount+Grid+Double:wght@400;700;900&family=Bowlby+One&family=Bungee&family=Lilita+One&family=Unbounded:wght@400;500;600;700;800&family=Luckiest+Guy&family=Cabin+Sketch:wght@400;700&display=swap",
      },

      // Preload the most critical glyph subsets (Latin woff2) so the display
      // and body faces are ready on first paint. crossOrigin is required for
      // font preloads to match the <link rel="stylesheet"> fetch.
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "https://fonts.gstatic.com/s/lilitaone/v17/i7dPIFZ9Zz-WBtRtedDbYEF8RXi4EwQ.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "https://fonts.gstatic.com/s/luckiestguy/v25/_gP_1RrxsjcxVyin9l9n_j2hTd52ijl7aQ.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "https://fonts.gstatic.com/s/cabinsketch/v23/QGYpz_kZZAGCONcK2A4bGOj8mNhNy_r-Kw.woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "https://fonts.gstatic.com/s/bitcountgriddouble/v3/WBK7rFjbakJVFOargiWSKQysDITG_S0VtG0x3HD2FYHVdlZI-rLlahmEAPp8wjYMvkPq48MVQo5RQf2svjnxa5Anx8-Y-pHdkVb0ByRHaxzbXaLbA9wfZNtjSZYdig.woff2",
        crossOrigin: "anonymous",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "OG Streamz",
          url: "https://ogbot.co.uk",
          description: "AI song generation, OG Bot assistant, and a coin-powered creator economy.",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "OG Streamz",
          url: "https://ogbot.co.uk",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const HC_BOOT = `(function(){try{var v=localStorage.getItem('og:high-contrast');if(v==='1')document.documentElement.classList.add('hc');}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: HC_BOOT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const bootstrapUser = useServerFn(ensureCurrentUserBootstrap);

  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active || !data.user) return;
      try {
        const result = await bootstrapUser({ data: { deviceId: getDeviceId() ?? undefined } });
        if (
          result.ensuredBossRole ||
          result.ensuredUserRole ||
          result.ensuredProfile ||
          result.welcomeCoinsGranted
        ) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["user-role", data.user.id] }),
            queryClient.invalidateQueries({ queryKey: ["profile", data.user.id] }),
          ]);
          router.invalidate();
        }

        // Claim a pending referral UUID or OG Leader code captured before sign-in.
        try {
          const pending =
            typeof window !== "undefined" ? localStorage.getItem("og_pending_ref") : null;
          if (pending) {
            let referrerId = pending;
            if (!/^[0-9a-f-]{36}$/i.test(pending)) {
              const { data: lookup, error: lookupError } = await supabase.rpc(
                "lookup_referrer_by_code",
                { p_code: pending.toUpperCase() },
              );
              if (lookupError) throw lookupError;
              const result = lookup as { found?: boolean; referrer_id?: string } | null;
              if (!result?.found || !result.referrer_id) throw new Error("Referral code not found");
              referrerId = result.referrer_id;
            }
            if (referrerId === data.user.id) {
              localStorage.removeItem("og_pending_ref");
              return;
            }
            const { data: claimed, error } = await supabase.rpc("claim_referral", {
              p_referrer: referrerId,
            });
            if (error) throw error;
            if (claimed === true) {
              queryClient.invalidateQueries({ queryKey: ["referral-summary"] });
            }
            localStorage.removeItem("og_pending_ref");
          }
        } catch (error) {
          // Keep the pending referral so a temporary network failure can retry.
          console.warn("pending referral claim failed", error);
        }
      } catch (error) {
        console.error("user bootstrap failed", error);
      }
    };

    bootstrap();
    // Also run right after an in-page sign-in / sign-up (no reload happens),
    // so welcome coins and pending referrals are claimed immediately.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(() => void bootstrap(), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [bootstrapUser, queryClient, router]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  // Global copy / right-click block (anti-scrape; lyrics protection).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const blockContext = (e: MouseEvent) => e.preventDefault();
    const blockCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Allow copying inside inputs the user typed in (form fields) but block
      // page text copy. The Library lyrics textarea adds its own onCopy block.
      if (target && target.tagName === "INPUT") return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", blockContext);
    document.addEventListener("copy", blockCopy);
    document.addEventListener("cut", blockCopy);
    return () => {
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("copy", blockCopy);
      document.removeEventListener("cut", blockCopy);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RevenueCatBridge>
          <SiteContentRealtimeBridge />
          <DisplayPrefsBridge />
          <AuraBridge />
          <SingleAudioBridge />
          <PersistentBackgroundMusic />
          <TrackUnlockReturnHandler />
          <UserActivityArchiver />
          <NativeAppLinkBridge />
          <InstallAppPrompt />
          <Outlet />
          <TrackReadyNotifier />
          <Toaster position="top-center" offset={72} />
        </RevenueCatBridge>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function SiteContentRealtimeBridge() {
  useSiteContentRealtime();
  return null;
}
