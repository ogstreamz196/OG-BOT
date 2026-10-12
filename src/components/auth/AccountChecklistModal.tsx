import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Circle, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { getMyTelegramLinkToken, getMyTelegramStatus } from "@/lib/telegram-admin.functions";
import { isValidUsername } from "@/components/auth/UsernamePrompt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const USERNAME_DOMAIN = "@ogstreamz.app";

function Step({
  n,
  title,
  done,
  doneText,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  doneText?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${done ? "border-primary/40 bg-primary/5" : "border-border"}`}
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={`font-semibold ${done ? "text-muted-foreground line-through decoration-2" : ""}`}
        >
          {n}. {title}
        </span>
      </div>
      {done && doneText && (
        <p className="ml-7 mt-1 truncate text-sm text-muted-foreground line-through">{doneText}</p>
      )}
      {!done && <div className="ml-7 mt-2 space-y-2">{children}</div>}
    </div>
  );
}

/** One "Complete your setup" checklist: username, recovery email, Telegram. */
export function AccountChecklistModal() {
  const { user } = useAuth();
  const profile = useProfile();
  const qc = useQueryClient();
  const statusFn = useServerFn(getMyTelegramStatus);
  const tokenFn = useServerFn(getMyTelegramLinkToken);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const launched = useRef(false);

  const tg = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const provider = (user?.app_metadata as { provider?: string } | undefined)?.provider;
  const providers = (user?.app_metadata as { providers?: string[] } | undefined)?.providers ?? [];
  const isSocial =
    provider === "google" ||
    provider === "apple" ||
    providers.includes("google") ||
    providers.includes("apple");
  const displayName = profile.data?.display_name ?? "";
  const userDone = !isSocial || isValidUsername(displayName);
  const pendingEmail = (user as { new_email?: string } | null)?.new_email;
  const emailDone = !!user?.email && !user.email.toLowerCase().endsWith(USERNAME_DOMAIN);
  const tgDone = tg.data?.state === "verified" || !!(tg.data as { linked?: boolean })?.linked;
  const ready = profile.isSuccess && tg.isSuccess;
  const allDone = userDone && emailDone && tgDone;
  const key = user ? `og-checklist-snoozed:${user.id}` : "";

  useEffect(() => {
    if (!ready || allDone || !key || sessionStorage.getItem(key)) return;
    const t = setTimeout(() => setOpen(true), 1300);
    return () => clearTimeout(t);
  }, [ready, allDone, key]);

  // Close for good once everything is ticked off.
  useEffect(() => {
    if (open && allDone) {
      toast.success("Setup complete — you're all set!");
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [open, allDone]);

  useEffect(() => {
    const onFocus = () => {
      if (!launched.current) return;
      launched.current = false;
      qc.invalidateQueries({ queryKey: ["my-telegram-status"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  const close = (v: boolean) => {
    setOpen(v);
    if (!v && key) sessionStorage.setItem(key, "1");
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!isValidUsername(v)) return toast.error("At least 5 letters/numbers, including one number.");
    setBusy("name");
    const { error } = await supabase.from("profiles").update({ display_name: v }).eq("id", user!.id);
    setBusy(null);
    if (error)
      return toast.error(error.message.includes("duplicate") ? "That username is taken." : error.message);
    await qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast.error("Enter a valid email address");
    setBusy("email");
    const { error } = await supabase.auth.updateUser(
      { email: v },
      { emailRedirectTo: `${window.location.origin}/` },
    );
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Check your inbox to confirm your email.");
  };

  const linkTelegram = async () => {
    setBusy("tg");
    try {
      const { token } = await tokenFn();
      launched.current = true;
      window.open(`https://t.me/OGStreamzBot?start=${token}`, "_blank");
    } catch {
      toast.error("Couldn't open Telegram — try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!user || !ready || (allDone && !open)) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Complete your setup
          </DialogTitle>
          <DialogDescription>
            Finish your checklist to unlock instant track alerts and keep your account safe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Step n={1} title="Username" done={userDone} doneText={displayName ? `@${displayName}` : undefined}>
            <form onSubmit={saveName} className="flex gap-2">
              <Input
                placeholder="e.g. Lexcel32"
                value={name}
                maxLength={30}
                onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
                className="h-11 text-base"
              />
              <Button type="submit" disabled={busy !== null} className="h-11">
                {busy === "name" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </form>
          </Step>

          <Step n={2} title="Recovery email" done={emailDone} doneText={user.email ?? undefined}>
            {pendingEmail && (
              <p className="text-xs text-muted-foreground">
                Waiting for you to confirm {pendingEmail} — check your inbox.
              </p>
            )}
            <form onSubmit={saveEmail} className="flex gap-2">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 text-base"
              />
              <Button type="submit" disabled={busy !== null} className="h-11">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </form>
          </Step>

          <Step n={3} title="Link Telegram" done={tgDone} doneText="Connected">
            <p className="text-xs text-muted-foreground">
              Get pinged the second your track is ready, plus OG Bot on Telegram.
            </p>
            <Button onClick={linkTelegram} disabled={busy !== null} className="h-11 w-full">
              {busy === "tg" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" /> Link Telegram (1 tap)
                </>
              )}
            </Button>
          </Step>
        </div>

        <Button variant="ghost" className="w-full" onClick={() => close(false)}>
          Remind me later
        </Button>
      </DialogContent>
    </Dialog>
  );
}
