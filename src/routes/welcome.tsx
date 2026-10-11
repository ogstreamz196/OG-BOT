import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import ogStreamzLogo from "@/assets/ogstreamz-logo.jpg.asset.json";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Music2, Sparkles, Loader2, Headphones, Wand2, Mic2, Pencil } from "lucide-react";
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
import { WelcomeBackdrop } from "@/components/layout/WelcomeBackdrop";
import { BackgroundMusicHeaderControl } from "@/components/PersistentBackgroundMusic";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CommunityShowcase } from "@/components/welcome/CommunityShowcase";
import { GuestBattle } from "@/components/welcome/GuestBattle";

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
const openAuth = () => window.dispatchEvent(new Event(OPEN_AUTH));

function AuthModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_AUTH, on);
    // Old #sign-in links still open the form.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href="#sign-in"]');
      if (a) {
        e.preventDefault();
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
          <AuthButtons size="xl" />
          <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">
            Free to start — new or returning, one form does both. Your Battle Zone chat comes with you.
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
        <CommunityShowcase />
        <GuestBattle onNeedAccount={openAuth} />
        <Superpowers />
        <HowItWorks />
        <AlbumCoverShowcase />

        <ClosingCta />
        <Footer />
        <AuthModal />

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
            <p className="mt-1 hidden items-center gap-1.5 sm:inline-flex text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground sm:text-[11px]">
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

function Hero() {
  return (
    <section className="relative mx-auto max-w-5xl px-3 pt-6 pb-10 sm:px-8 sm:py-14">
      <div className="relative mx-auto w-full max-w-3xl text-center">
        <div className="mx-auto inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-primary sm:text-xs">
          <span>👑 15 days free VIP</span>
          <span aria-hidden className="text-primary/50">·</span>
          <span>No card</span>
        </div>

        <h1 className="font-display mt-5 text-[clamp(2.2rem,10vw,5.5rem)] font-black leading-[0.92] tracking-[-0.045em] [text-wrap:balance]">
          <span className="wc-pop block">TURN ANY IDEA</span>
          <span className="wc-pop block" style={{ animationDelay: "0.15s" }}>
            INTO A{" "}
            <span className="wc-bounce-soft inline-block italic text-accent">HIT</span>
          </span>
          <span className="wc-pop block" style={{ animationDelay: "0.3s" }}>
            IN SECONDS.
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-base font-medium text-muted-foreground sm:text-xl">
          Drill, afrobeats, pop or savage roasts — your words, real vocals, cover art included.
        </p>

        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <a
            href="#sign-in"
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-7 text-lg font-black uppercase tracking-wide text-primary-foreground shadow-glow transition-transform hover:scale-[1.03]"
          >
            🔥 Start creating free
          </a>
          <a
            href="#studio"
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-7 text-base font-bold text-foreground backdrop-blur transition hover:border-primary/60"
          >
            <Music2 className="h-5 w-5" /> See what it makes
          </a>
        </div>

        <ul className="mx-auto mt-5 flex flex-wrap justify-center gap-2 text-xs font-semibold text-foreground/80 sm:text-sm">
          {[
            { i: <Mic2 className="h-3.5 w-3.5" />, t: "Real vocals" },
            { i: <Sparkles className="h-3.5 w-3.5" />, t: "Album cover" },
            { i: <span>🤬</span>, t: "Foul Mouth mode" },
          ].map((c) => (
            <li
              key={c.t}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1"
            >
              {c.i}
              {c.t}
            </li>
          ))}
        </ul>

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
            } catch {
              // storage may be blocked (private mode)
            }
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
      } catch {
        // storage may be blocked (private mode)
      }
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
    } catch {
      // storage may be blocked (private mode)
    }
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
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-primary sm:text-xs">
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


function Superpowers() {
  const items = [
    {
      key: "foul",
      emoji: "🤬",
      title: "Foul Mouth Mode",
      body: "Savage roasts, raw bars, no filter. Turn the heat from Mild to Demon.",
    },
    {
      key: "cover",
      emoji: "💿",
      title: "Instant album covers",
      body: "Every track comes with its own artwork, ready to share.",
    },
    {
      key: "vip",
      emoji: "👑",
      title: "15 days of free VIP",
      body: "Every style unlocked from signup — drill, bhangra, afrobeats and more.",
    },
  ];
  return (
    <section id="how-it-works" className="relative scroll-mt-24 border-t border-border/40">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8 sm:py-16">
        <p className="text-center text-xs font-black uppercase tracking-[0.25em] text-primary">
          ⚡ Your superpowers
        </p>
        <div className="mt-6 grid gap-3 sm:gap-5 md:grid-cols-3">
          {items.map((it) => (
            <article
              key={it.key}
              className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-card sm:p-6"
            >
              <CardEditBadge />
              <span className="text-4xl">{it.emoji}</span>
              <EditableContent
                as="h3"
                contentKey={`welcome.power.${it.key}.title`}
                defaultValue={it.title}
                className="font-display mt-3 block text-2xl font-black tracking-tight"
              />
              <EditableContent
                as="p"
                multiline
                contentKey={`welcome.power.${it.key}.body`}
                defaultValue={it.body}
                className="mt-2 block text-sm leading-snug text-muted-foreground sm:text-base"
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <Pencil className="h-5 w-5" />, title: "Type your idea", body: "A name, a roast, a memory." },
    { icon: <Wand2 className="h-5 w-5" />, title: "Pick the vibe", body: "Choose a style and mood." },
    { icon: <Headphones className="h-5 w-5" />, title: "OG Bot cooks it", body: "Your song + cover, ready to play." },
  ];
  return (
    <section className="relative border-t border-border/40">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-8 sm:py-16">
        <h2 className="font-display text-center text-3xl font-black tracking-[-0.03em] sm:text-5xl">
          3 taps to your first track
        </h2>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-5">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex items-start gap-4 rounded-2xl border border-border/60 bg-card/70 p-5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-brand text-primary-foreground shadow-glow">
                {s.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                  Step {i + 1}
                </p>
                <h3 className="font-display text-lg font-black">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section id="how" className="relative border-t border-border/40">
      <div className="relative mx-auto max-w-3xl px-4 py-14 text-center sm:px-8 sm:py-20">
        <CardEditBadge />
        <EditableContent
          as="p"
          contentKey="welcome.closing.eyebrow"
          defaultValue="Ready?"
          className="block text-xs font-black uppercase tracking-[0.25em] text-primary sm:text-sm"
        />
        <EditableContent
          as="h2"
          contentKey="welcome.closing.title"
          defaultValue="Your next prompt could be a hit."
          multiline
          className="font-display mt-4 block text-balance text-4xl font-black leading-[0.95] tracking-[-0.04em] sm:text-6xl"
        />
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-xl">
          Free account in seconds · 15 days of VIP on us · No card needed.
        </p>
        <a
          href="#sign-in"
          className="mt-8 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-8 text-lg font-black uppercase tracking-wide text-primary-foreground shadow-glow transition-transform hover:scale-[1.03]"
        >
          🔥 Start creating free
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:px-8">
        <span className="inline-flex items-center gap-2">
          © {new Date().getFullYear()} OG Studio · Prompt songs powered by{" "}
          <OgBotLogo className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-6">
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
