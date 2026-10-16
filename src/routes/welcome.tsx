import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import ogStreamzLogo from "@/assets/ogstreamz-logo.jpg.asset.json";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Music2, Sparkles, Loader2, Headphones, Wand2, Pencil } from "lucide-react";
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
import musicHubHero from "@/assets/musichub-hero.jpg";
import battleZoneArt from "@/assets/og-bot-battle-zone.webp";
import createTrackArt from "@/assets/og-bot-create-track.webp";
import masterLogo from "@/assets/og-bot-master-logo.webp";
import { ModeCard } from "@/components/welcome/ModeCard";
import { OgPowers } from "@/components/welcome/OgPowers";
import { SectionHeading, SportsGuideFeature } from "@/components/welcome/SportsGuideFeature";
import { SHARE_IMAGE } from "@/lib/seo";
import { WelcomeBackdrop } from "@/components/layout/WelcomeBackdrop";
import { BackgroundMusicHeaderControl } from "@/components/PersistentBackgroundMusic";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CommunityShowcase } from "@/components/welcome/CommunityShowcase";
import { GuestBattle } from "@/components/welcome/GuestBattle";
import {
  GuestStudio,
  guestCreationAvailable,
  startGuestCreation,
} from "@/components/welcome/GuestStudio";
import { WelcomeSeoFallback } from "@/components/seo/WelcomeSeoFallback";
import { DodgyLogo } from "@/components/welcome/DodgyLogo";
import {
  CreateNowWizard,
  GUEST_PENDING_SONG_KEY,
  type WizardDraft,
  type WizardResult,
} from "@/components/library/CreateNowWizard";

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
  // Crawlers get the landing copy as HTML; people get the real page on load.
  pendingComponent: WelcomeSeoFallback,
  component: WelcomePage,
  head: () => ({
    meta: [
      { title: "OG Bot | AI Music Creation, Rap Battles & Entertainment" },
      {
        name: "description",
        content:
          "Enter OG Bot for AI-powered music creation, rap battles and entertainment. Create tracks, challenge the bot and explore your next creative idea.",
      },
      { property: "og:title", content: "OG Bot | AI Music Creation, Rap Battles & Entertainment" },
      {
        property: "og:description",
        content:
          "Enter OG Bot for AI-powered music creation, rap battles and entertainment. Create tracks, challenge the bot and explore your next creative idea.",
      },
      { property: "og:image", content: SHARE_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "OG Bot Battle Zone badge" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OG Bot | AI Music Creation, Rap Battles & Entertainment" },
      {
        name: "twitter:description",
        content:
          "Enter OG Bot for AI-powered music creation, rap battles and entertainment. Create tracks, challenge the bot and explore your next creative idea.",
      },
      { name: "twitter:image", content: SHARE_IMAGE },
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

const PENDING_REF_KEY = "og_pending_ref";

function safeRelativeNext(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return null;
  // Same-origin relative path only.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Legacy or auth-only paths would 404 or loop after sign-in — send home.
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  const legacy = [
    "",
    "/dashboard",
    "/home",
    "/welcome",
    "/login",
    "/signin",
    "/signup",
    "/auth",
    "/auth/callback",
  ];
  if (legacy.includes(path)) return null;
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
      const validCode = !!normalizedRef && /^(?:OG-)?[A-Z0-9]{3,32}$/.test(normalizedRef);
      if ((validUuid || validCode) && ref && normalizedRef) {
        const stored = validUuid ? ref.toLowerCase() : normalizedRef;
        try {
          localStorage.setItem(PENDING_REF_KEY, stored);
        } catch {
          /* ignore */
        }
      }
    }
    let cancelled = false;
    // Read ?next= at sign-in time: cards set it after the page has opened.
    const go = () => {
      const target = safeRelativeNext() ?? "/";
      if (target === "/") navigate({ to: "/", replace: true });
      else window.location.replace(target);
    };
    // Guest (anonymous) sessions belong on this page, so they don't redirect.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session && !data.session.user.is_anonymous) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        session &&
        !session.user.is_anonymous
      ) {
        go();
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
          <p className="font-display text-sm font-black uppercase tracking-[0.3em] text-foreground sm:text-base">
            OG Streamz Presentz
          </p>
          <OgBotLogo className="mx-auto mt-3 h-44 w-44 rounded-3xl shadow-glow sm:h-56 sm:w-56" />
          <h2 className="mt-3 text-lg font-semibold text-foreground sm:text-xl">
            {native ? "Create your account" : "Sign in to your account"}
          </h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {native
              ? "Choose a username and password to get started."
              : "Continue with a connected account, or use your username and password."}
          </p>
        </div>

        {!native && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3">{PRIMARY_DEVICES.map(renderTile)}</div>
            <div className="my-5 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="font-auth-display text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                or with username
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <div>
          <EmailAuthPanel disabled={pending !== null} />
        </div>
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
  const [forgotOpen, setForgotOpen] = useState(false);
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
          onClick={() => setForgotOpen(true)}
          className="mt-4 h-12 w-full rounded-lg border-2 border-border bg-secondary/60 text-center text-base font-semibold text-foreground transition-colors hover:border-primary/60"
        >
          Forgot password?
        </button>
      )}
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />

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

const OPEN_AUTH = "og:open-auth";
const OPEN_WIZARD = "og:open-guest-wizard";
const openAuth = () => window.dispatchEvent(new Event(OPEN_AUTH));
const openAuthFromBattle = () =>
  window.dispatchEvent(new CustomEvent(OPEN_AUTH, { detail: { fromBattle: true } }));
const openSongAuth = (title: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_AUTH, { detail: { songTitle: title } }));
const openWizard = () => window.dispatchEvent(new Event(OPEN_WIZARD));
/** Guest made a track: sign up / in to keep it, then land in the library. */
const openSaveTrackAuth = (title: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("next", "/library");
  window.history.replaceState(null, "", url.toString());
  window.dispatchEvent(new CustomEvent(OPEN_AUTH, { detail: { savedTrack: title } }));
};
const OPEN_BATTLE = "og:open-guest-battle";
const openBattle = () => window.dispatchEvent(new Event(OPEN_BATTLE));
/** Earn page (referrals, daily drop) is for members: sign in, then land on /referrals. */
const openEarn = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("next", "/referrals");
  window.history.replaceState(null, "", url.toString());
  openAuth();
};
/** Sports Guide is for members: sign in first, then land on /sports. */
const openSportsGuide = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("next", "/sports");
  window.history.replaceState(null, "", url.toString());
  openAuth();
};

/** Signed-out song wizard: nothing generates until the visitor signs in. */
function GuestWizard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_WIZARD, on);
    return () => window.removeEventListener(OPEN_WIZARD, on);
  }, []);
  // Website guests cook straight away (silent guest account + 99p); the phone
  // apps, or a backend with guest sign-ins off, fall back to signing up first.
  const guestCook = guestCreationAvailable();
  const done = async (result: WizardResult, draft: WizardDraft) => {
    if (guestCook && (await startGuestCreation(result))) return;
    try {
      localStorage.setItem(GUEST_PENDING_SONG_KEY, JSON.stringify({ result, draft }));
    } catch {
      /* storage blocked */
    }
    // Send them to the studio after sign-in (survives Google/Apple round-trip).
    const url = new URL(window.location.href);
    url.searchParams.set("next", "/library");
    window.history.replaceState(null, "", url.toString());
    setTimeout(() => openSongAuth(result.title), 200);
  };
  return (
    <CreateNowWizard
      open={open}
      onOpenChange={setOpen}
      onComplete={(result, draft) => void done(result, draft)}
      guestMode
      submitLabel={guestCook ? "Cook Master Track" : "Create my song"}
    />
  );
}

function AuthModal() {
  const [open, setOpen] = useState(false);
  const [songTitle, setSongTitle] = useState<string | null>(null);
  const [fromBattle, setFromBattle] = useState(false);
  const [savedTrack, setSavedTrack] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (
        e as CustomEvent<{ songTitle?: string; fromBattle?: boolean; savedTrack?: string }>
      ).detail;
      setSongTitle(d?.songTitle ?? null);
      setSavedTrack(d?.savedTrack ?? null);
      setFromBattle(!!d?.fromBattle);
      setOpen(true);
    };
    window.addEventListener(OPEN_AUTH, on);
    // Old #sign-in links still open the form.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href="#sign-in"]');
      if (a) {
        e.preventDefault();
        setFromBattle(false);
        setSavedTrack(null);
        setOpen(true);
      }
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener(OPEN_AUTH, on);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogTitle className="sr-only">Sign in or join OG Streamz</DialogTitle>
        <div id="sign-in">
          {songTitle && (
            <div className="mb-4 rounded-2xl border-2 border-primary bg-card p-4 text-card-foreground">
              <p className="font-display text-xl font-black">Your track is ready to cook 🎧</p>
              <p className="mt-1 text-sm">
                <span className="font-bold">"{songTitle}"</span> is saved. Join free, grab your 25
                welcome coins and cook it in one tap.
              </p>
              <ul className="mt-3 grid gap-1.5 text-sm font-semibold">
                <li>🪙 25 free welcome coins (this track costs 5)</li>
                <li>👑 15 days of VIP — every style unlocked</li>
                <li>💸 Earn commission when friends join</li>
              </ul>
              <p className="mt-3 text-xs font-medium text-card-foreground/80">
                🔒 100% free. Email only for password resets — no spam, ever.
              </p>
            </div>
          )}
          {savedTrack && (
            <div className="mb-4 rounded-2xl border-2 border-amber-300/60 bg-card p-4 text-card-foreground">
              <p className="font-display text-xl font-black">Save your track forever 💾</p>
              <p className="mt-1 text-sm">
                <span className="font-bold">"{savedTrack}"</span> moves into your library as soon as
                you're in. New here? Join free below. Already an OG? Sign in.
              </p>
              <ul className="mt-3 grid gap-1.5 text-sm font-semibold">
                <li>🪙 Free welcome coins</li>
                <li>👑 15 days of VIP on us</li>
              </ul>
            </div>
          )}
          {fromBattle && (
            <div className="mb-4 rounded-2xl border-2 border-primary bg-card p-4 text-card-foreground">
              <p className="font-display text-xl font-black">Don't stop now 🔥</p>
              <p className="mt-1 text-sm">Join free to keep battling — your chat comes with you.</p>
              <ul className="mt-3 grid gap-1.5 text-sm font-semibold">
                <li>🔒 Unlock Private chat — just you &amp; OG Bot, nobody else sees a word</li>
                <li>🪙 Earn OG Coins for every roast you land</li>
                <li>👑 15 days of VIP on us</li>
              </ul>
            </div>
          )}
          <AuthButtons size="xl" />
          <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">
            Free to start — new or returning, one form does both. Your Battle Zone chat comes with
            you.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WelcomePage() {
  // Single session check for the whole page.
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
        <MoreFromOgBot />
        <Superpowers />
        <CommunityShowcase />
        <ClosingCta />
        <Footer />
        <AuthModal />
        <GuestWizard />
        <GuestStudio
          onSave={openSaveTrackAuth}
          onSignUpForCoins={(track) => {
            // After sign-up the library picks this song up and offers the pay
            // step, where the welcome coins cover it.
            if (track.result) {
              try {
                localStorage.setItem(
                  GUEST_PENDING_SONG_KEY,
                  JSON.stringify({ result: track.result, draft: {} }),
                );
              } catch {
                /* storage blocked */
              }
            }
            const url = new URL(window.location.href);
            url.searchParams.set("next", "/library");
            window.history.replaceState(null, "", url.toString());
            openSongAuth(track.title);
          }}
        />
        <BattleModal />

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
          <img
            src={ogStreamzLogo.url}
            alt=""
            aria-hidden
            className="h-12 w-12 shrink-0 rounded-2xl object-cover shadow-glow ring-1 ring-white/15 sm:h-14 sm:w-14"
          />
          <div className="min-w-0 leading-none">
            <p className="font-display truncate text-lg font-black uppercase tracking-tight sm:text-xl">
              OG Streamz
            </p>
            <p className="mt-1 hidden items-center gap-1.5 sm:inline-flex text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-foreground/85 sm:text-xs">
              <span>Powered by</span>
              <OgBotLogo className="h-6 w-6 sm:h-7 sm:w-7" />
              <span>OG Bot</span>
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <BackgroundMusicHeaderControl />
          <Button size="sm" className="h-10 rounded-xl font-black uppercase" onClick={openAuth}>
            Sign in / Join
          </Button>
        </div>
      </nav>
    </header>
  );
}

/** The original OG Bot logo, centred at the top and fading into the page. */
function MasterLogo() {
  return (
    <div className="relative mx-auto w-full max-w-[13.5rem] sm:max-w-[15rem] lg:max-w-[16rem]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] inset-y-[18%] rounded-full bg-glow-primary blur-2xl"
      />
      <DodgyLogo
        src={masterLogo}
        alt="OG Bot logo: the red TV-headed mascot in sunglasses with blue flames"
        size={512}
        aspectRatio="1607 / 1275"
        glow={false}
        priority
        className="relative w-full"
        imageClassName="[mask-image:radial-gradient(ellipse_at_center,black_42%,transparent_72%)]"
      />
      {/* A slow light sweep across the logo (off with reduced motion). */}
      <span
        aria-hidden
        className="og-logo-sweep pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_65%)]"
      />
    </div>
  );
}

/** The two main actions, used in the hero and again at the bottom of the page. */
function PrimaryActions({ className = "" }: { className?: string }) {
  return (
    <div className={`mx-auto grid w-full max-w-xl gap-3 sm:grid-cols-2 ${className}`}>
      <Button
        size="lg"
        variant="destructive"
        onClick={openBattle}
        className="h-14 rounded-2xl text-base font-black uppercase tracking-wide shadow-glow"
      >
        Enter Battle Zone
      </Button>
      <Button
        size="lg"
        onClick={openWizard}
        className="h-14 rounded-2xl text-base font-black uppercase tracking-wide shadow-glow"
      >
        Create a Track
      </Button>
    </div>
  );
}

/** Battle Zone opens as its own popup so the page stays clean. */
function BattleModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_BATTLE, on);
    return () => window.removeEventListener(OPEN_BATTLE, on);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[94dvh] w-[calc(100vw-1rem)] max-w-xl flex-col overflow-hidden border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Battle Zone — roast OG Bot</DialogTitle>
        <GuestBattle
          onNeedAccount={() => {
            setOpen(false);
            setTimeout(openAuthFromBattle, 150);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto max-w-5xl px-3 pt-3 pb-8 sm:px-8 sm:pt-6 sm:pb-14">
      <MasterLogo />
      <div className="relative mx-auto -mt-2 w-full max-w-3xl text-center sm:mt-0 md:max-w-5xl">
        <h1 className="font-display text-[clamp(1.8rem,8vw,2.6rem)] font-black leading-[0.95] tracking-[-0.035em] [text-wrap:balance] md:text-[clamp(2.4rem,4.6vw,3.4rem)]">
          <span className="wc-pop block md:inline">ROAST THE BOT. </span>
          <span className="wc-pop block md:inline" style={{ animationDelay: "0.12s" }}>
            DROP THE{" "}
            <span className="wc-bounce-soft inline-block italic text-accent">DISS.</span>{" "}
          </span>
          <span className="wc-pop block md:block" style={{ animationDelay: "0.24s" }}>
            OR COOK A HIT.
          </span>
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-sm font-medium text-foreground/85 sm:mt-4 sm:text-lg md:max-w-2xl">
          Step into the world of OG Bot. Enter the battle, create your sound and unleash your
          creativity. Your ideas. Your rules. No limits.
        </p>
      </div>

      <div id="modes" className="mx-auto mt-5 max-w-4xl scroll-mt-24 sm:mt-7">
        <h2 className="text-center text-xs font-black uppercase tracking-[0.3em] text-foreground/80 sm:text-sm">
          Choose your mode
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:mt-5 sm:gap-6">
          <ModeCard
            tone="crimson"
            className="og-rise"
            image={battleZoneArt}
            imageAlt="OG Bot Battle Zone badge"
            eyebrow="Live now"
            live
            title="Battle Zone"
            description="Roast OG Bot. Bank coins for every hit."
            cta="Enter Battle Zone"
            onClick={openBattle}
          />
          <ModeCard
            tone="blue"
            className="og-rise"
            style={{ animationDelay: "0.1s" }}
            image={createTrackArt}
            imageAlt="OG Bot Create a Track badge"
            eyebrow="AI studio"
            title="Music Hub"
            description="Your idea. Real vocals. Cover art. Done."
            cta="Create a Track"
            onClick={openWizard}
          />
        </div>
      </div>
    </section>
  );
}

/** Supporting features under the two main modes. */
function MoreFromOgBot() {
  return (
    <section aria-labelledby="more-title" className="relative border-t border-border/40">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-8 sm:py-16">
        <SectionHeading id="more-title" eyebrow="More from OG Bot" title="Never miss a game" />
        <SportsGuideFeature onOpen={openSportsGuide} />
      </div>
    </section>
  );
}

const PERSONAL_BANNER_KEY = "welcome.personal_banner.dismissed";

function Superpowers() {
  return (
    <OgPowers
      onBattle={openBattle}
      onCreate={openWizard}
      onEarn={openEarn}
      editBadge={<CardEditBadge />}
    />
  );
}

function ClosingCta() {
  return (
    <section id="how" className="relative border-t border-border/40">
      <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-8 sm:py-16">
        <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-card/90 px-5 py-8 text-center shadow-card backdrop-blur-xl sm:px-10 sm:py-12">
          <CardEditBadge />
          <EditableContent
            as="p"
            contentKey="welcome.closing.eyebrow"
            defaultValue="Ready?"
            className="block text-xs font-black uppercase tracking-[0.3em] text-foreground/75 sm:text-sm"
          />
          <EditableContent
            as="h2"
            contentKey="welcome.closing.title"
            defaultValue="Your next prompt could be a hit."
            multiline
            className="font-display mt-3 block text-balance text-4xl font-black leading-[0.95] tracking-[-0.04em] sm:text-6xl"
          />
          <p className="mx-auto mt-4 max-w-md text-sm text-foreground/85 sm:text-lg">
            Free account in seconds. 15 days of VIP on us, no card needed.
          </p>
          <PrimaryActions className="mt-7" />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-5 py-8 text-center text-sm text-foreground/80 sm:flex-row sm:justify-between sm:px-8 sm:text-left">
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-1 sm:order-2"
        >
          <Link
            to="/policy"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Privacy
          </Link>
          <Link
            to="/terms"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Terms
          </Link>
          <Link
            to="/trust"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Trust
          </Link>
          <Link
            to="/styles/rap"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            AI rap generator
          </Link>
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center rounded-md px-3 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign in
          </Link>
        </nav>
        <p className="inline-flex items-center gap-2 sm:order-1">
          <OgBotLogo className="h-5 w-5" />© {new Date().getFullYear()} OG Studio · Powered by OG
          Bot
        </p>
      </div>
    </footer>
  );
}
