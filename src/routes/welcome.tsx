import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  Music2,
  Sparkles,
  Loader2,
  Headphones,
  Heart,
  Star,
  Wand2,
  Mic2,
  Pencil,
} from "lucide-react";
import { EditableContent } from "@/components/admin/EditableContent";
import {
  AdminEditModeProvider,
  AdminEditModeToggle,
  useAdminEditMode,
} from "@/components/admin/AdminEditMode";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

import { lovable } from "@/integrations/lovable";
import { getDeviceId } from "@/lib/device-id";
import { checkDeviceAccountAllowed } from "@/lib/device-limit.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import partyCoverAsset from "@/assets/album-party-anthem.jpg.asset.json";
import heartbreakCoverAsset from "@/assets/album-heartbreak.jpg.asset.json";
import drillCoverAsset from "@/assets/album-drill.jpg.asset.json";
import afrobeatsCoverAsset from "@/assets/album-afrobeats.jpg.asset.json";
import { WelcomeBackdrop } from "@/components/layout/WelcomeBackdrop";
import { BackgroundMusicHeaderControl } from "@/components/PersistentBackgroundMusic";

function OgBotLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <img
      src={ogBotAsset.url}
      alt="OG Bot"
      width={512}
      height={512}
      decoding="async"
      className={`inline-block aspect-square shrink-0 rounded-xl object-contain object-center align-middle shadow-glow ${className}`}
    />
  );
}

export const Route = createFileRoute("/welcome")({
  ssr: false,
  component: WelcomePage,
  head: () => ({
    meta: [
      { title: "OG Studio — Prompt Songs & Album Covers" },
      {
        name: "description",
        content:
          "Turn prompts, moods and memories into different song styles with album covers. Sign in with Google or Apple.",
      },
      { property: "og:title", content: "OG Studio — Prompt Songs & Album Covers" },
      {
        property: "og:description",
        content: "Prompt rap, pop, drill, afrobeats, heartbreak and party songs with cover art.",
      },
      {
        property: "og:image",
        content:
          "https://ogstreamz.co.uk/__l5e/assets-v1/c71b8b8a-3ff4-448e-ad15-3446b8fe5e88/ogbot.png",
      },
      { property: "og:image:alt", content: "OG Streamz bot" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content:
          "https://ogstreamz.co.uk/__l5e/assets-v1/c71b8b8a-3ff4-448e-ad15-3446b8fe5e88/ogbot.png",
      },
    ],
  }),
});

type OAuthProvider = "google" | "apple";

function useIsNativeApp() {
  const [native, setNative] = useState(() => Capacitor.isNativePlatform());
  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
  }, []);
  return native;
}

const albumCovers = [
  {
    title: "Party anthem",
    prompt: "Make it loud, funny and ready for the group chat.",
    style: "Pop · Dance",
    image: partyCoverAsset.url,
  },
  {
    title: "Heartbreak hook",
    prompt: "Turn the messy message into a chorus people feel.",
    style: "R&B · Ballad",
    image: heartbreakCoverAsset.url,
  },
  {
    title: "Street energy",
    prompt: "Give it a cold intro, sharp bars and heavy bass.",
    style: "Rap · Drill",
    image: drillCoverAsset.url,
  },
  {
    title: "Summer bounce",
    prompt: "Sunny, catchy and made for the speakers.",
    style: "Afrobeats · Vibes",
    image: afrobeatsCoverAsset.url,
  },
];

const PENDING_REF_KEY = "og_pending_ref";

function safeRelativeNext(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return null;
  // Same-origin relative path only.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function useRedirectIfSignedIn() {
  const navigate = useNavigate();
  useEffect(() => {
    // Capture a referral UUID or OG Leader code for the post-signup claim.
    if (typeof window !== "undefined") {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const normalizedRef = ref?.trim().toUpperCase();
      const validUuid = !!ref && /^[0-9a-f-]{36}$/i.test(ref);
      const validCode = !!normalizedRef && /^(?:OG-)?[A-Z0-9]{6}$/.test(normalizedRef);
      if ((validUuid || validCode) && ref && normalizedRef) {
        const stored = validUuid
          ? ref.toLowerCase()
          : normalizedRef.startsWith("OG-")
            ? normalizedRef
            : `OG-${normalizedRef}`;
        try {
          localStorage.setItem(PENDING_REF_KEY, stored);
        } catch {
          /* ignore */
        }
      }
    }
    let cancelled = false;
    const target = safeRelativeNext() ?? "/";
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        if (target === "/") navigate({ to: "/", replace: true });
        else window.location.replace(target);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        if (target === "/") navigate({ to: "/", replace: true });
        else window.location.replace(target);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);
}

function useOAuthSignIn() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const signIn = useCallback(
    async (provider: OAuthProvider) => {
      setPending(provider);
      try {
        const next = safeRelativeNext();
        // Preserve `next` across a full-page OAuth round-trip so we return to
        // /welcome with the same param and can forward the user to their
        // original destination (e.g. the MCP consent URL) after sign-in.
        const isNativeApp = Boolean(
          (
            window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
          ).Capacitor?.isNativePlatform?.(),
        );
        // Always finish the provider flow in the browser, outside Android's app-link
        // path. The return screen can then explicitly open even unverified APKs.
        const redirectUri = isNativeApp
          ? `${window.location.origin}/sign-in-return${next ? `?next=${encodeURIComponent(next)}` : ""}`
          : next
            ? `${window.location.origin}/welcome?next=${encodeURIComponent(next)}`
            : window.location.origin;
        const result = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: redirectUri,
          extraParams: provider === "google" ? { prompt: "select_account" } : undefined,
        });
        if (result.error) {
          const raw = (result.error.message ?? "").toLowerCase();
          const transient =
            raw.includes("authorization code") ||
            raw.includes("code verifier") ||
            raw.includes("pkce");
          if (!transient) toast.error(result.error.message || `${provider} sign-in failed`);
          return;
        }
        if (result.redirected) return;
        if (next) window.location.replace(next);
        else navigate({ to: "/", replace: true });
      } catch (e) {
        const raw = (e instanceof Error ? e.message : "").toLowerCase();
        const transient =
          raw.includes("authorization code") ||
          raw.includes("code verifier") ||
          raw.includes("pkce");
        if (!transient) toast.error(e instanceof Error ? e.message : "Sign-in failed");
      } finally {
        setPending(null);
      }
    },
    [navigate],
  );

  return { signIn, pending };
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.6-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.2 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.2 3.2-2.5.7-1 1.2-2.1 1.5-3.3-2.5-.9-3.2-2.7-3.2-3.5zM13.8 5.2c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.6.8-1.2 2-1 3.1 1.1.1 2.2-.6 2.9-1.5z" />
    </svg>
  );
}

type Device = {
  key: string;
  label: string;
  provider: OAuthProvider;
  Icon: (p: { className?: string }) => ReactElement;
  iconClass?: string;
};

const PRIMARY_DEVICES: Device[] = [
  { key: "google", label: "Continue with Google", provider: "google", Icon: GoogleIcon },
  {
    key: "apple",
    label: "Continue with Apple ID",
    provider: "apple",
    Icon: AppleIcon,
    iconClass: "text-black",
  },
];

function AuthButtons({ size = "lg" }: { size?: "lg" | "xl" }) {
  const { signIn, pending } = useOAuthSignIn();
  const native = useIsNativeApp();
  const compact = size === "lg";

  const renderTile = (d: Device) => {
    const isPending = pending === d.provider;
    return (
      <Button
        key={d.key}
        type="button"
        variant="outline"
        onClick={() => signIn(d.provider)}
        disabled={pending !== null}
        aria-label={d.label}
        className="h-14 min-w-0 justify-center gap-2.5 rounded-lg border-border/80 bg-secondary/75 px-3 font-auth-body text-base font-semibold text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary/60 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
      >
        {isPending ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : d.provider === "google" ? (
          <GoogleIcon className="h-6 w-6 shrink-0" />
        ) : (
          <AppleIcon className="h-6 w-6 shrink-0 text-foreground" />
        )}
        <span className="truncate">{d.provider === "google" ? "Google" : "Apple"}</span>
      </Button>
    );
  };

  return (
    <div className={`mx-auto w-full font-auth-body ${compact ? "max-w-md" : "max-w-lg"}`}>
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/95 px-5 py-6 shadow-[0_24px_70px_-24px_hsl(var(--primary)/0.65)] backdrop-blur-xl sm:px-7 sm:py-7">
        <div
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-destructive via-primary to-destructive"
          aria-hidden
        />
        <div className="text-center">
          <OgBotLogo className="mx-auto h-24 w-24 rounded-2xl sm:h-28 sm:w-28" />
          <h2 className="mt-3 text-lg font-semibold text-foreground sm:text-xl">
            {native ? "Create your account" : "Sign in to your account"}
          </h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {native
              ? "Choose a username and password to get started."
              : "Continue with a connected account, or use your username and password."}
          </p>
        </div>

        <div className="mt-6">
          <EmailAuthPanel disabled={pending !== null} />
        </div>

        {!native && (
          <>
            <div className="my-5 flex items-center gap-4" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="font-auth-display text-3xl font-black uppercase leading-none text-foreground sm:text-4xl">
                or
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">{PRIMARY_DEVICES.map(renderTile)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** Usernames become a deterministic hidden address so no inbox is needed. */
const USERNAME_DOMAIN = "ogstreamz.app";
const normalizeHandle = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
const toLoginEmail = (v: string) =>
  v.includes("@") ? v.trim() : `${normalizeHandle(v)}@${USERNAME_DOMAIN}`;

function EmailAuthPanel({ disabled }: { disabled?: boolean }) {
  const native = useIsNativeApp();
  // One smart form: tries sign-in first, creates the account when it's new.
  const [mode, setMode] = useState<"enter" | "reset">("enter");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCreating = busy && mode === "enter";

  useEffect(() => {
    if (isCreating) {
      setCreateProgress(0);
      progressIntervalRef.current = setInterval(() => {
        setCreateProgress((prev) => {
          if (prev >= 88) return prev;
          return prev + Math.max(1, Math.floor((90 - prev) / 6));
        });
      }, 180);
    } else {
      setCreateProgress(0);
    }
    return () => {
      if (progressIntervalRef.current !== null) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isCreating]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "reset") {
      if (!email) {
        toast.error("Enter the email you signed up with");
        return;
      }
      setBusy(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setResetSent(true);
        toast.success("Reset link sent — check your inbox.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send the reset email");
      } finally {
        setBusy(false);
      }
      return;
    }
    const handle = email.trim();
    const isEmail = handle.includes("@");
    if (!isEmail && normalizeHandle(handle).length < 3) {
      toast.error("Pick a username with at least 3 letters or numbers");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");

      return;
    }
    const loginEmail = toLoginEmail(handle);

    setBusy(true);
    try {
      // 1) Existing account? Sign straight in.
      const signIn = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (!signIn.error) {
        toast.success("Welcome back!");
        return;
      }
      const msg = (signIn.error.message ?? "").toLowerCase();
      if (msg.includes("disabled")) {
        toast.error(
          native
            ? "Username sign-up is unavailable right now. Please try again shortly."
            : "Username sign-up is switched off right now — use Google or Apple, or try again shortly.",
        );
        return;
      }
      const unknownUser =
        msg.includes("invalid login credentials") || msg.includes("user not found");
      if (!unknownUser) throw signIn.error;

      // 2) Device limit: max 2 accounts per device (blocks free-coin farming).
      const deviceId = getDeviceId();
      if (deviceId) {
        const check = await checkDeviceAccountAllowed({ data: { deviceId } });
        if (!check.allowed) {
          toast.error("This device already has 2 accounts — sign in to one of them.");
          return;
        }
      }

      // 3) Otherwise create it — unless the name exists with another password.
      const signUp = await supabase.auth.signUp({
        email: loginEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/welcome`,
          data: { display_name: isEmail ? handle.split("@")[0] : normalizeHandle(handle) },
        },
      });
      if (signUp.error) {
        const upMsg = (signUp.error.message ?? "").toLowerCase();
        if (upMsg.includes("already registered") || upMsg.includes("already been registered")) {
          toast.error("That username is taken — check your password.");
          return;
        }
        if (upMsg.includes("password should be at least")) {
          toast.error(signUp.error.message);
          return;
        }
        if (upMsg.includes("disabled")) {
          toast.error(
            native
              ? "Username sign-up is unavailable right now. Please try again shortly."
              : "Username sign-up is switched off right now — use Google or Apple, or try again shortly.",
          );
          return;
        }

        throw signUp.error;
      }

      if (signUp.data.user?.identities?.length === 0) {
        toast.error("That username is taken — check your password.");
        return;
      }
      toast.success("Account created — welcome to OG Streamz!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 text-center">
        <h3 className="font-auth-display text-3xl uppercase leading-none text-foreground">
          {mode === "reset" ? "Reset password" : "Create account / Sign in"}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {mode === "reset"
            ? "Enter the email linked to your account."
            : "New username? We’ll create your account automatically."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5" id="wc-auth-panel">
        <div className="space-y-2">
          <Label
            htmlFor="wc-email"
            className="ml-0.5 block text-left text-sm font-semibold text-foreground"
          >
            {mode === "reset" ? "Email" : "Username"}
          </Label>
          <Input
            id="wc-email"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={mode === "reset" ? "you@example.com" : "Enter your username"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-14 rounded-lg border-2 border-border bg-surface px-4 font-auth-body text-base text-foreground shadow-inner placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/35"
            disabled={busy || disabled}
            required
          />
        </div>
        {mode !== "reset" && (
          <div className="space-y-2">
            <Label
              htmlFor="wc-password"
              className="ml-0.5 block text-left text-sm font-semibold text-foreground"
            >
              Password
            </Label>

            <Input
              id="wc-password"
              type="password"
              autoComplete="current-password"
              placeholder="Create/use existing password, must be 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-14 rounded-lg border-2 border-border bg-surface px-4 font-auth-body text-base text-foreground shadow-inner placeholder:text-[13px] placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/35"
              disabled={busy || disabled}
              required
            />
          </div>
        )}

        {mode === "reset" && (
          <p className="text-sm text-muted-foreground">
            {resetSent
              ? "We sent a reset link. Open it on this device to set a new password — it expires shortly."
              : "We'll email you a secure link to set a new password."}
          </p>
        )}

        {isCreating && (
          <div className="space-y-1.5 rounded-xl border border-primary/40 bg-primary/10 p-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-black uppercase tracking-wider text-primary-foreground">
                Getting you in
              </span>
              <span className="text-xs font-bold tabular-nums text-primary-foreground">
                {createProgress}%
              </span>
            </div>
            <Progress value={createProgress} className="h-1.5 bg-primary/20" />
            <p className="text-xs text-muted-foreground">Setting up your OG Studio profile.</p>
            <div aria-live="polite" className="sr-only">
              Signing you in, {createProgress} percent complete.
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || disabled}
          className="h-14 w-full rounded-lg font-auth-body text-base font-bold shadow-[0_12px_28px_-12px_hsl(var(--primary))] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              {mode === "reset" ? "Sending..." : "One sec..."}
            </>
          ) : mode === "reset" ? (
            resetSent ? (
              "Resend reset link"
            ) : (
              "Send reset link"
            )
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" aria-hidden />
              Sign in or create account
            </>
          )}
        </Button>
      </form>

      {mode !== "reset" && (
        <button
          type="button"
          onClick={() => {
            setResetSent(false);
            setMode("reset");
          }}
          className="mt-5 w-full text-center text-sm font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Forgot password?
        </button>
      )}

      {mode === "reset" && (
        <button
          type="button"
          onClick={() => {
            setResetSent(false);
            setMode("enter");
          }}
          className="mt-5 w-full text-center text-sm font-semibold text-foreground/80 underline underline-offset-4 hover:text-foreground"
        >
          Back
        </button>
      )}
    </div>
  );
}

function WelcomePage() {
  // Single session check for the whole page (AuthButtons is mounted twice).
  useRedirectIfSignedIn();
  return (
    <AdminEditModeProvider>
      <main
        suppressHydrationWarning
        className="safe-top safe-bottom safe-x relative min-h-dvh overflow-x-hidden text-foreground"
      >
        <WelcomeBackdrop />
        <TopNav />
        <Hero />
        <FoulMouthHype />
        <AlbumCoverShowcase />
        <Pillars />

        <ClosingCta />
        <Footer />

        <div className="fixed bottom-4 right-4 z-50">
          <AdminEditModeToggle />
        </div>
      </main>
    </AdminEditModeProvider>
  );
}

function CardEditBadge() {
  const { enabled } = useAdminEditMode();
  const { isAdmin } = useRole();
  if (!enabled || !isAdmin) return null;
  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-20 grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow ring-2 ring-background"
      title="This card is editable — click any text to edit"
    >
      <Pencil className="h-3.5 w-3.5" />
    </div>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-background/40 backdrop-blur-xl">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:h-20 sm:px-8"
      >
        <Link
          to="/welcome"
          aria-label="OG Streamz — home"
          className="group flex min-w-0 items-center gap-3"
        >
          <span
            aria-hidden
            className="wc-wiggle grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow sm:h-11 sm:w-11"
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 leading-none">
            <p className="font-display truncate text-lg font-black uppercase tracking-tight sm:text-xl">
              OG Streamz
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground sm:text-xs">
              <span>Powered by</span>
              <OgBotLogo className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
              <span>OG Bot</span>
            </p>
          </div>
        </Link>
        <BackgroundMusicHeaderControl />
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-5xl flex-col justify-center px-3 pt-6 pb-10 sm:min-h-0 sm:px-8 sm:py-14">
      {/* Floating stickers */}
      <Sticker className="left-[4%] top-10 wc-float" rotate="-12">
        <Heart className="h-6 w-6 text-pink-400" />
      </Sticker>
      <Sticker className="right-[6%] top-16 wc-float-slow" rotate="14">
        <Star className="h-6 w-6 text-amber-300" />
      </Sticker>
      <Sticker className="left-[8%] bottom-[18%] wc-float-slow" rotate="8">
        <Headphones className="h-6 w-6 text-primary" />
      </Sticker>
      <Sticker className="right-[6%] bottom-[22%] wc-float" rotate="-10">
        <Mic2 className="h-6 w-6 text-violet-300" />
      </Sticker>

      <div className="relative mx-auto w-full max-w-3xl text-center">
        <div className="mx-auto mb-3 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border-2 border-primary/40 bg-primary/15 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-primary shadow-[0_0_28px_-8px_oklch(0.7_0.2_300_/_0.7)] sm:text-sm">
          <span>🎵 MusicHUB</span>
          <span aria-hidden className="text-primary/50">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-foreground">
            Powered by
            <OgBotLogo className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="font-black uppercase tracking-tight">OG Bot</span>
          </span>
        </div>

        <h1 className="font-display mt-5 text-[clamp(2rem,9.5vw,5.5rem)] font-black leading-[0.92] tracking-[-0.045em] [text-wrap:balance] hyphens-none drop-shadow-[0_8px_30px_rgba(80,60,255,0.35)] sm:mt-8 sm:leading-[0.9] sm:tracking-[-0.05em]">
          <span className="wc-pop block">PROMPT IT.</span>
          <span className="wc-pop block" style={{ animationDelay: "0.15s" }}>
            MAKE A{" "}
            <span
              className="italic text-gradient-brand wc-bounce-soft inline-block"
              style={{ animationDelay: "0.3s" }}
            >
              PERSONAL
            </span>
          </span>
          <span className="wc-pop block" style={{ animationDelay: "0.3s" }}>
            MUSIC TRACK.
          </span>
        </h1>

        <div id="sign-in" className="mx-auto mt-6 max-w-md scroll-mt-24 sm:mt-10">
          <AuthButtons size="xl" />
          <p className="mt-3 text-center text-sm font-semibold tracking-wide text-muted-foreground sm:mt-6 sm:text-lg sm:font-bold sm:text-foreground">
            Free to start — no card required
          </p>
        </div>
      </div>
    </section>
  );
}

const PERSONAL_BANNER_KEY = "welcome.personal_banner.dismissed";

function AlbumCoverShowcase() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window !== "undefined" && localStorage.getItem(PERSONAL_BANNER_KEY) === "1") {
          return;
        }
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { count } = await supabase
            .from("songs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id);
          if ((count ?? 0) > 0) {
            try {
              localStorage.setItem(PERSONAL_BANNER_KEY, "1");
            } catch {}
            return;
          }
        }
        if (!cancelled) setHidden(false);
      } catch {
        if (!cancelled) setHidden(false);
      }
    })();
    const onGenerate = () => {
      try {
        localStorage.setItem(PERSONAL_BANNER_KEY, "1");
      } catch {}
      setHidden(true);
    };
    window.addEventListener("og:generate-start", onGenerate);
    return () => {
      cancelled = true;
      window.removeEventListener("og:generate-start", onGenerate);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(PERSONAL_BANNER_KEY, "1");
    } catch {}
    setHidden(true);
  }, []);

  if (hidden) return null;

  return (
    <div className="mx-auto mt-10 max-w-3xl px-1 sm:mt-16 sm:px-0">
      <div className="relative overflow-hidden rounded-[1.75rem] border-2 border-primary/40 bg-gradient-to-br from-card/80 via-card/60 to-card/80 p-5 text-center shadow-[0_18px_60px_-20px_rgba(255,60,60,0.45)] backdrop-blur-xl sm:rounded-[2rem] sm:p-8">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss personalization reminder"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-background/60 text-muted-foreground transition hover:text-foreground"
        >
          ✕
        </button>
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.22em] text-primary sm:text-xs">
          ✨ Reminder
        </span>
        <h3 className="font-display mt-3 text-balance text-[clamp(1.5rem,6vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.025em] sm:mt-4 sm:text-4xl">
          Make it as personal as you like —{" "}
          <em className="italic text-gradient-brand">the more you share, the better the song</em>
        </h3>
        <p className="mt-3 text-sm font-medium text-muted-foreground sm:mt-4 sm:text-base">
          Names, inside jokes, occasions, favourite things — drop it all in. OG Bot turns your
          details into a track that feels like <em className="italic text-foreground">them</em>. 🎧
        </p>
      </div>
    </div>
  );
}

function Sticker({
  children,
  className,
  rotate,
}: {
  children: React.ReactNode;
  className?: string;
  rotate: string;
}) {
  return (
    <div
      className={`absolute hidden sm:grid place-items-center h-12 w-12 rounded-2xl border-2 border-white/20 bg-card/80 shadow-card backdrop-blur-xl ${className ?? ""}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </div>
  );
}

function Pillars() {
  const items: Array<{
    icon: React.ReactNode;
    emoji: string;
    title: React.ReactNode;
    body: string;
    tilt: string;
    key: string;
    floatClass: string;
  }> = [
    {
      key: "hub",
      icon: <Music2 className="h-7 w-7" />,
      emoji: "🎵",
      title: "Prompt anything",
      body: "Any idea — roast, love note, inside joke.",
      tilt: "-2",
      floatClass: "wc-float",
    },
    {
      key: "bot",
      icon: <Wand2 className="h-7 w-7" />,
      emoji: "🪄",
      title: "Pick the vibe",
      body: "Drill, rap, afrobeats, pop or ballad.",
      tilt: "1.5",
      floatClass: "wc-float-slow",
    },
    {
      key: "msg",
      icon: <Sparkles className="h-7 w-7" />,
      emoji: "💿",
      title: "Cover included",
      body: "Cover art plus a track ready to play.",
      tilt: "-1",
      floatClass: "wc-wiggle",
    },
  ];

  return (
    <section id="studio" className="relative scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <div className="grid gap-3 sm:gap-4 md:grid-cols-3 lg:gap-5">
          {items.map((it, idx) => (
            <div
              key={it.key}
              style={{ transform: `rotate(${it.tilt}deg)` }}
              className="md:transition-transform md:duration-300 md:hover:rotate-0"
            >
              <article
                style={{ animationDelay: `${idx * 0.14}s`, contain: "paint" }}
                className="group wc-pop relative h-full overflow-hidden rounded-[2rem] border-2 border-white/15 bg-card/80 p-4 shadow-[0_18px_50px_-20px_rgba(80,60,255,0.35)] transition-all duration-300 max-sm:rounded-[1.5rem] sm:p-6 md:backdrop-blur-xl md:hover:-translate-y-2 md:hover:border-primary/40 md:hover:shadow-glow"
              >
                {/* hover aurora */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-[radial-gradient(circle_at_top_right,oklch(0.55_0.22_268/0.22),transparent_60%)]"
                />
                <CardEditBadge />
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow transition-transform duration-300 sm:h-13 sm:w-13 md:group-hover:scale-110 md:group-hover:rotate-6">
                    {it.icon}
                  </span>
                  <span className={`text-2xl sm:text-3xl ${it.floatClass}`}>{it.emoji}</span>
                </div>
                <EditableContent
                  as="h3"
                  contentKey={`welcome.pillar.${it.key}.title`}
                  defaultValue={String(it.title)}
                  className="font-display mt-3 block text-2xl font-black tracking-tight sm:mt-4 sm:text-3xl"
                />
                <EditableContent
                  as="p"
                  multiline
                  contentKey={`welcome.pillar.${it.key}.body`}
                  defaultValue={it.body}
                  className="mt-2 block text-sm leading-snug text-balance text-muted-foreground sm:text-base"
                />
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FoulMouthHype() {
  return (
    <section className="relative border-t border-white/10">
      <div className="relative mx-auto max-w-4xl px-4 py-10 sm:px-8 sm:py-16">
        <div className="relative overflow-hidden rounded-[2.5rem] border-2 border-destructive/40 bg-gradient-to-br from-destructive/25 via-destructive/10 to-transparent p-6 shadow-[0_30px_80px_-30px_oklch(0.62_0.22_25_/_0.7)] sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-destructive/30 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-primary/30 blur-3xl"
          />

          <div className="relative grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex items-center justify-center">
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute -inset-3 animate-pulse rounded-full bg-destructive/30 blur-2xl"
                />
                <div className="relative grid h-28 w-28 place-items-center rounded-[2rem] border-2 border-destructive/60 bg-background/60 text-6xl shadow-[0_0_40px_-6px_oklch(0.62_0.22_25_/_0.8)] sm:h-36 sm:w-36 sm:text-8xl">
                  🤬
                </div>
              </div>
            </div>

            <div className="min-w-0 text-center md:text-left">
              <p className="inline-flex items-center gap-2 rounded-full border border-destructive/60 bg-destructive/20 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.22em] text-destructive sm:text-xs">
                ⚠ Before you walk away
              </p>
              <h2 className="font-display mt-4 text-balance text-3xl font-black leading-[0.95] tracking-[-0.03em] sm:text-5xl md:text-6xl">
                Don't forget to flip <span className="italic text-destructive">Foul Mouth</span> ON.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-foreground/85 sm:text-2xl">
                The clean version is cute.{" "}
                <span className="font-black text-foreground">Foul Mouth</span> is where{" "}
                <span className="inline-flex items-center gap-1.5 align-middle">
                  <OgBotLogo className="h-6 w-6" />
                  <span className="font-black">OG Bot</span>
                </span>{" "}
                actually goes off — savage roasts, real bars, no filter.
              </p>
              <p className="mt-4 text-base font-semibold text-muted-foreground sm:text-lg">
                Free to try. No card. One tap inside MusicHUB.
              </p>
              <div className="mt-7">
                <a
                  href="#sign-in"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-7 py-4 text-lg font-black uppercase tracking-wide text-primary-foreground shadow-glow ring-1 ring-primary/40 transition-transform hover:scale-[1.03] sm:text-xl"
                >
                  🔥 Try OG Bot free
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section id="how" className="relative border-t border-white/10">
      <div className="relative mx-auto max-w-3xl px-4 py-14 text-center sm:px-8 sm:py-20">
        <CardEditBadge />
        <EditableContent
          as="p"
          contentKey="welcome.closing.eyebrow"
          defaultValue="Ready?"
          className="block text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-sm"
        />
        <EditableContent
          as="h2"
          contentKey="welcome.closing.title"
          defaultValue="Your next prompt could be a hit."
          multiline
          className="font-display mt-4 block text-balance text-4xl font-semibold leading-[0.95] tracking-[-0.045em] sm:mt-5 sm:text-6xl md:text-7xl"
        />
        <EditableContent
          as="p"
          multiline
          contentKey="welcome.closing.body"
          defaultValue="Sign in. Type the idea. Pick the vibe. Get the cover and the song. 🎉"
          className="mx-auto mt-6 block max-w-2xl text-lg text-muted-foreground sm:mt-8 sm:text-2xl md:text-3xl"
        />

        <div className="mx-auto mt-10 max-w-2xl sm:mt-12">
          <AuthButtons size="xl" />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const native = useIsNativeApp();
  const { signIn, pending } = useOAuthSignIn();
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:px-8">
        <span className="inline-flex items-center gap-2">
          © {new Date().getFullYear()} OG Studio · Prompt songs powered by{" "}
          <OgBotLogo className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-6">
          {native && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending !== null}
              onClick={() => signIn("google")}
              className="text-muted-foreground"
              title="D.EV Google sign-in"
            >
              D.EV
            </Button>
          )}
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
