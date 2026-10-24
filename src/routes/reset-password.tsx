import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RESEND_COOLDOWN_S = 30;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) {
        setLinkValid(true);
        setReady(true);
        if (session?.user?.email) setEmail(session.user.email);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setLinkValid(Boolean(data.session));
      if (data.session?.user?.email) setEmail(data.session.user.email);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    const target = email.trim();
    if (!target) {
      setStatus({ tone: "error", text: "Enter the email address you signed up with." });
      return;
    }
    setResending(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setCooldown(RESEND_COOLDOWN_S);
      setStatus({
        tone: "ok",
        text: `New reset link sent to ${target}. Check your inbox and spam folder.`,
      });
      toast.success("Reset email sent");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not send the reset email";
      setStatus({ tone: "error", text });
      toast.error(text);
    } finally {
      setResending(false);
    }
  };

  const resendBlock = (
    <div className="space-y-2">
      {!linkValid && (
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 text-base"
          aria-label="Email address"
        />
      )}
      <Button
        type="button"
        variant="outline"
        onClick={resend}
        disabled={resending || cooldown > 0}
        className="h-12 w-full font-display font-black uppercase tracking-wide"
      >
        {resending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Sending…
          </>
        ) : cooldown > 0 ? (
          `Resend available in ${cooldown}s`
        ) : (
          <>
            <MailCheck className="mr-2 h-4 w-4" aria-hidden /> Resend reset email
          </>
        )}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={`text-center text-sm ${status?.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {status?.text ??
          (email
            ? `We'll send a fresh link to ${email}.`
            : "Didn't get the email? Enter your address and we'll send a new link.")}
      </p>
    </div>
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 5) {
      toast.error("Password must be at least 5 characters");

      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated", {
        description: "Sign in with your new password.",
      });
      // End the temporary recovery session so the user signs in fresh.
      await supabase.auth.signOut().catch(() => {});
      setTimeout(() => navigate({ to: "/welcome" }), 1800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border-2 border-primary/40 bg-primary/15">
          <KeyRound className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <h1 className="font-display text-[clamp(1.75rem,7vw,2.5rem)] font-black uppercase leading-tight tracking-tight text-foreground">
          Set a new password
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a new password for your OG Streamz account.
        </p>
      </header>

      <section className="rounded-3xl border-2 border-white/15 bg-white/[0.04] p-5">
        {!ready ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
            <p className="font-display text-lg font-black uppercase tracking-wide text-foreground">
              Password updated
            </p>
            <p className="text-sm text-muted-foreground">Taking you to the sign-in page…</p>
          </div>
        ) : !linkValid ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              This reset link is invalid or has expired. Send yourself a fresh one below.
            </p>
            {resendBlock}
            <Button
              asChild
              variant="ghost"
              className="h-11 w-full font-display font-black uppercase tracking-wide"
            >
              <Link to="/welcome">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="rp-password"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  New password
                </Label>
                <Input
                  id="rp-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 5 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-base"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="rp-confirm"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Confirm password
                </Label>
                <Input
                  id="rp-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-12 text-base"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="h-12 w-full font-display text-base font-black uppercase tracking-wide"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  "Update password"
                )}
              </Button>
            </form>
            <div className="mt-5 border-t border-white/10 pt-4">{resendBlock}</div>
          </>
        )}
      </section>
    </main>
  );
}

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Reset your password | 0G B0T — AI Songs & Diss Tracks" },
      {
        name: "description",
        content:
          "Set a new password for your OG Streamz account using the secure reset link we emailed you.",
      },
      { property: "og:title", content: "Reset your password | 0G B0T — AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content:
          "Set a new password for your OG Streamz account using the secure reset link we emailed you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});
