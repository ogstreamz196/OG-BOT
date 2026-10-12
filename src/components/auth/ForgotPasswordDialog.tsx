import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requestAccountRecovery } from "@/lib/account-recovery.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const recoverFn = useServerFn(requestAccountRecovery);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"reset" | "boss" | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [handle, setHandle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [bossSent, setBossSent] = useState(false);

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return toast.error("Enter a valid email address");
    setBusy("reset");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    setResetSent(true);
    toast.success("Reset link sent — check your inbox.");
  };

  const askBoss = async (e: FormEvent) => {
    e.preventDefault();
    if (handle.trim().length < 2) return toast.error("Enter your username");
    if (!EMAIL_RE.test(contactEmail.trim()))
      return toast.error("Enter a valid email so we can send your reset link");
    setBusy("boss");
    try {
      await recoverFn({ data: { handle: handle.trim(), email: contactEmail.trim() } });
      setBossSent(true);
      toast.success("Request sent to OGSTREAMZ");
    } catch {
      toast.error("Couldn't send right now — try again shortly.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> Account recovery
          </DialogTitle>
          <DialogDescription>Choose how you want to get back in.</DialogDescription>
        </DialogHeader>

        <form onSubmit={sendReset} className="space-y-2">
          <Label htmlFor="fp-email">Reset by email</Label>
          <Input
            id="fp-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
          />
          <Button type="submit" disabled={busy !== null} className="h-12 w-full">
            {busy === "reset" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : resetSent ? (
              "Resend reset link"
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>

        <div className="my-1 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
            or
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {bossSent ? (
          <p className="rounded-md bg-primary/10 p-3 text-sm">
            Sent! OGSTREAMZ has your request and will email a reset link to{" "}
            <b>{contactEmail}</b>.
          </p>
        ) : (
          <form onSubmit={askBoss} className="space-y-2">
            <Label>Message OGSTREAMZ to recover your account</Label>
            <p className="text-xs text-muted-foreground">
              Forgot your email or signed up with a username only? Tell us who you are and where to
              send your reset link.
            </p>
            <Input
              placeholder="Your username, e.g. Lexcel32"
              value={handle}
              maxLength={60}
              onChange={(e) => setHandle(e.target.value)}
              className="h-12 text-base"
              autoCapitalize="none"
            />
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Email to send your reset link"
              value={contactEmail}
              maxLength={255}
              onChange={(e) => setContactEmail(e.target.value)}
              className="h-12 text-base"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy !== null}
              className="h-12 w-full"
            >
              {busy === "boss" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" /> Message OGSTREAMZ
                </>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
