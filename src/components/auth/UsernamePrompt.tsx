import { useEffect, useState, type FormEvent } from "react";
import { AtSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Letters and at least one number, letters/numbers only, 5–30 chars. */
export function isValidUsername(v: string) {
  return /^[A-Za-z0-9]{5,30}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v);
}

/**
 * Asks Google/Apple accounts to choose a username (their profile name).
 * Closable, but reopens on every new sign-in (per browser session) until done.
 */
export function UsernamePrompt() {
  const { user } = useAuth();
  const profile = useProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const provider = (user?.app_metadata as { provider?: string } | undefined)?.provider;
  const providers = (user?.app_metadata as { providers?: string[] } | undefined)?.providers ?? [];
  const isSocial =
    provider === "google" ||
    provider === "apple" ||
    providers.includes("google") ||
    providers.includes("apple");
  const current = profile.data?.display_name ?? "";
  const needsName = isSocial && profile.isSuccess && !isValidUsername(current);
  const key = user ? `og-username-dismissed:${user.id}` : "";

  useEffect(() => {
    if (!needsName || !key) return;
    if (sessionStorage.getItem(key)) return;
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [needsName, key]);

  const close = (v: boolean) => {
    setOpen(v);
    if (!v && key) sessionStorage.setItem(key, "1");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!isValidUsername(value)) {
      toast.error("Use at least 5 letters and numbers, including one number.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: value })
      .eq("id", user!.id);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That username is taken." : error.message);
      return;
    }
    toast.success(`You're ${value} now.`);
    await qc.invalidateQueries({ queryKey: ["profile"] });
    close(false);
  };

  if (!needsName) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AtSign className="h-5 w-5 text-primary" /> Pick your username
          </DialogTitle>
          <DialogDescription>
            This is your name across OG BOT. Letters and numbers only, at least 5 characters, with
            at least one number.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoComplete="username"
            placeholder="e.g. Lexcel32"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
            className="h-12 text-base"
            required
          />
          <Button type="submit" disabled={busy || !isValidUsername(name)} className="h-12 w-full">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save username"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => close(false)}>
            Remind me next time
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
