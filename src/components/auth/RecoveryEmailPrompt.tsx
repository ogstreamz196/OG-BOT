import { useEffect, useState, type FormEvent } from "react";
import { MailPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Username accounts sign in with a placeholder address on this domain. */
const USERNAME_DOMAIN = "@ogstreamz.app";

/**
 * Asks username-only accounts to add a real email so "Forgot password" works.
 * Closable, but reopens on every new sign-in (per browser session) until done.
 */
export function RecoveryEmailPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const needsEmail = !!user?.email?.toLowerCase().endsWith(USERNAME_DOMAIN);
  const pending = (user as { new_email?: string } | null)?.new_email;
  const key = user ? `og-recovery-email-dismissed:${user.id}` : "";

  useEffect(() => {
    if (!needsEmail || !key) return;
    if (sessionStorage.getItem(key)) return;
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [needsEmail, key]);

  const close = (v: boolean) => {
    setOpen(v);
    if (!v && key) sessionStorage.setItem(key, "1");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter a valid email address");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser(
      { email: value },
      { emailRedirectTo: `${window.location.origin}/` },
    );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Check your inbox to confirm your email.");
    close(false);
  };

  if (!needsEmail) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailPlus className="h-5 w-5 text-primary" /> Add a recovery email
          </DialogTitle>
          <DialogDescription>
            So you can reset your password if you ever forget it. We only use it for account
            recovery.
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <p className="rounded-md bg-primary/10 p-2 text-sm">
            Waiting for you to confirm {pending} — check your inbox, or enter a different one.
          </p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            required
          />
          <Button type="submit" disabled={busy} className="h-12 w-full">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save email"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => close(false)}>
            Remind me next time
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
