import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, CheckCircle2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [
      { title: "Change Password | OG BOT — AI Songs & Diss Tracks" },
      {
        name: "description",
        content:
          "Update your OG Streamz account password securely by confirming your current password first.",
      },
      { property: "og:title", content: "Change Password — OG Streamz" },
      {
        property: "og:description",
        content: "Securely update the password for your OG Streamz account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChangePasswordPage,
});

const schema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z
      .string()
      .min(5, "New password must be at least 5 characters")
      .max(72, "New password must be 72 characters or fewer"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    message: "New passwords don't match",
    path: ["confirm"],
  })
  .refine((v) => v.next !== v.current, {
    message: "New password must be different from your current one",
    path: ["next"],
  });

function ChangePasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const email = user?.email ?? "";
  // Users created through Google/Apple have no password identity to replace.
  const hasPasswordIdentity = !user || (user.identities ?? []).some((i) => i.provider === "email");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ current, next, confirm });
    if (!parsed.success) {
      toast.error("Password not changed", {
        description: parsed.error.issues[0]?.message ?? "Check the form and try again.",
      });
      return;
    }
    if (!email) {
      toast.error("Password not changed", {
        description: "No email on this account — password sign-in isn't available.",
      });
      return;
    }

    setBusy(true);
    try {
      // Re-authenticate: proves the person at the keyboard knows the current
      // password before we allow a replacement.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (reauthError) {
        toast.error("Current password is incorrect", {
          description: "Double-check it and try again — your password was not changed.",
        });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password updated", {
        description: "Your new password is active. Taking you back to settings…",
      });
      setTimeout(() => navigate({ to: "/settings" }), 1800);
    } catch (err) {
      toast.error("Couldn't update your password", {
        description: err instanceof Error ? err.message : "Something went wrong. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <header className="text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border-2 border-primary/40 bg-primary/15">
          <KeyRound className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <h1 className="font-display text-[clamp(1.6rem,6.5vw,2.25rem)] font-black uppercase leading-tight tracking-tight text-foreground">
          Change password
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirm your current password, then set a new one.
        </p>
      </header>

      <section className="rounded-3xl border-2 border-primary/40 bg-card/85 p-5 shadow-[0_16px_44px_-18px_hsl(var(--primary)/0.55)] backdrop-blur-xl">
        {done ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
            <p className="font-display text-lg font-black uppercase tracking-wide text-foreground">
              Password updated
            </p>
            <p className="text-sm text-muted-foreground">Taking you back to settings…</p>
          </div>
        ) : !hasPasswordIdentity ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              This account signs in with Google or Apple, so there's no password to change. Manage
              it with your provider instead.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/settings">Back to settings</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={email}
              readOnly
              hidden
            />

            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                minLength={8}
                maxLength={72}
                required
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">At least 5 characters.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {show ? "Hide passwords" : "Show passwords"}
            </button>

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </section>

      <Link
        to="/settings"
        className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to settings
      </Link>
    </main>
  );
}
