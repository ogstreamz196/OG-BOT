import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Accounts made from an OG CARROM username (see
 * /api/public/carrom/register-guest) have no password yet, so they could
 * only get back in through carrom. This asks them to set one once; then they
 * sign in anywhere with their username.
 */
export function CarromPasswordCard() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = (user?.user_metadata ?? {}) as { source?: string; password_set?: boolean };
  if (!user || meta.source !== "carrom" || meta.password_set) return null;

  const name = profile?.display_name ?? "your username";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || busy) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Saved. Sign in with ${name} and your password from now on.`);
  };

  return (
    <section className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Welcome from OG CARROM, {name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your OG B0T account uses your carrom name. Set a password so you can sign in with{" "}
            <span className="font-semibold text-foreground">{name}</span> on any device.
          </p>
          <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="New password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="New password"
            />
            <Button type="submit" disabled={password.length < 8 || busy} className="shrink-0">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save password
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
