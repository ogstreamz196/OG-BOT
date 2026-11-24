import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Mail, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { getMyTelegramLinkToken, getMyTelegramStatus } from "@/lib/telegram-admin.functions";
import { isValidUsername } from "@/components/auth/UsernamePrompt";
import { hasRealEmail, nextSetupStep } from "@/lib/setup-steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * One slim reminder under the header instead of a setup pop-up (the Boss,
 * 2026-11-24): link Telegram, then once that's done, add a recovery email.
 * Each stays until it's done (no close button); then the header is clear.
 * Google/Apple sign-ins without a username are asked for that first.
 */
export function SetupReminderBar() {
  const { user } = useAuth();
  const profile = useProfile();
  const qc = useQueryClient();
  const statusFn = useServerFn(getMyTelegramStatus);
  const tokenFn = useServerFn(getMyTelegramLinkToken);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const launched = useRef(false);

  const tg = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    enabled: !!user,
    staleTime: 30_000,
  });

  // Back from Telegram: check whether the link went through.
  useEffect(() => {
    const onFocus = () => {
      if (!launched.current) return;
      launched.current = false;
      void qc.invalidateQueries({ queryKey: ["my-telegram-status"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  const meta = user?.app_metadata as { provider?: string; providers?: string[] } | undefined;
  const isSocial = ["google", "apple"].some(
    (p) => meta?.provider === p || (meta?.providers ?? []).includes(p),
  );
  const step =
    user && profile.isSuccess && tg.isSuccess
      ? nextSetupStep({
          username: !isSocial || isValidUsername(profile.data?.display_name ?? ""),
          telegram:
            tg.data?.state === "verified" ||
            !!(tg.data as { linked?: boolean } | undefined)?.linked,
          email: hasRealEmail(user.email),
        })
      : null;

  // A new step starts with an empty box.
  useEffect(() => setValue(""), [step]);

  if (!step || !user) return null;
  const pendingEmail = (user as { new_email?: string }).new_email;

  const linkTelegram = async () => {
    setBusy(true);
    try {
      const { token } = await tokenFn();
      launched.current = true;
      window.open(`https://t.me/OGStreamzBot?start=${token}`, "_blank");
    } catch {
      toast.error("Couldn't open Telegram, try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (step === "username") {
      if (!isValidUsername(v))
        return toast.error("At least 5 letters/numbers, including one number.");
      setBusy(true);
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: v })
        .eq("id", user.id);
      setBusy(false);
      if (error)
        return toast.error(
          error.message.includes("duplicate") ? "That username is taken." : error.message,
        );
      await qc.invalidateQueries({ queryKey: ["profile"] });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast.error("Enter a valid email address");
    setBusy(true);
    const { error } = await supabase.auth.updateUser(
      { email: v },
      { emailRedirectTo: `${window.location.origin}/library` },
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Check your inbox to confirm your email.");
  };

  const Icon = step === "telegram" ? Send : step === "email" ? Mail : UserRound;
  const text =
    step === "telegram"
      ? "Link Telegram: get pinged the second your track is ready."
      : step === "email"
        ? pendingEmail
          ? `Confirm ${pendingEmail}: check your inbox (or use another email).`
          : "Add a recovery email so you never lose your account."
        : "Pick your username.";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 sm:text-sm"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">{text}</span>
      </span>
      {step === "telegram" ? (
        <Button
          size="sm"
          onClick={linkTelegram}
          disabled={busy}
          className="h-7 bg-emerald-500 px-3 text-xs font-bold text-black hover:bg-emerald-400"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Link (1 tap)"}
        </Button>
      ) : (
        <form onSubmit={save} className="flex items-center gap-1.5">
          <Input
            type={step === "email" ? "email" : "text"}
            inputMode={step === "email" ? "email" : "text"}
            autoComplete={step === "email" ? "email" : "username"}
            placeholder={step === "email" ? "you@example.com" : "e.g. Lexcel32"}
            value={value}
            maxLength={step === "email" ? 254 : 30}
            onChange={(e) =>
              setValue(
                step === "username" ? e.target.value.replace(/[^A-Za-z0-9]/g, "") : e.target.value,
              )
            }
            className="h-7 w-44 bg-background/60 text-base text-foreground sm:w-56 sm:text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy}
            className="h-7 bg-emerald-500 px-3 text-xs font-bold text-black hover:bg-emerald-400"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}
