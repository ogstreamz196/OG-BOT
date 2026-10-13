import { useState, type FormEvent } from "react";
import { Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { isValidUsername } from "@/components/auth/UsernamePrompt";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function vipIdFor(name: string) {
  const clean = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return clean.startsWith("OG") ? clean : `OG${clean}`;
}

/** When a member becomes VIP, their username becomes their VIP ID — confirmed once, then locked. */
export function VipNamePrompt() {
  const { user } = useAuth();
  const { hasVipRole } = useRole();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["vip-name", user?.id],
    enabled: !!user && hasVipRole,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, og_vip_id, vip_name_confirmed_at")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const proposed = q.data?.og_vip_id ?? (q.data?.display_name ? vipIdFor(q.data.display_name) : "");
  const open = !!user && hasVipRole && !!q.data && !q.data.vip_name_confirmed_at && !!proposed && !dismissed;

  const save = async (username: string) => {
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: username, vip_name_confirmed_at: new Date().toISOString() })
      .eq("id", user!.id);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That one's taken — try another." : error.message);
      return;
    }
    toast.success(`Locked in. You're ${username} for the whole of your VIP.`);
    await qc.invalidateQueries({ queryKey: ["vip-name"] });
    await qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidUsername(name)) {
      toast.error("Use at least 5 letters and numbers, including one number.");
      return;
    }
    void save(vipIdFor(name));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDismissed(true)}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto border-coin/40">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-coin/20 text-coin">
            <Crown className="h-7 w-7" />
          </span>
          <DialogTitle className="mt-3 font-display text-xl uppercase">Welcome to VIP 👑</DialogTitle>
          <DialogDescription className="mt-1 text-sm">
            As a VIP your username becomes your VIP ID. Once you confirm, it{" "}
            <b>can't be changed for as long as your VIP lasts</b>.
          </DialogDescription>
        </div>
        {!choosing ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-coin/50 bg-coin/10 p-3 text-center">
              <div className="text-[10px] font-black uppercase tracking-widest text-coin">Proposed VIP ID</div>
              <div className="font-mono text-2xl font-black tracking-widest">{proposed}</div>
            </div>
            <Button className="h-12 w-full" disabled={busy} onClick={() => void save(proposed)}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Yes, make me ${proposed}`}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setChoosing(true)}>
              Choose a different name (one last chance)
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-center text-xs text-muted-foreground">
              Choose wisely — this is your final pick for the length of your VIP.
            </p>
            <Input
              autoFocus
              placeholder="e.g. Lexcel32"
              value={name}
              maxLength={28}
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
              className="h-12 text-base"
            />
            {name && (
              <p className="text-center text-sm">
                Your VIP ID will be <b className="font-mono">{vipIdFor(name)}</b>
              </p>
            )}
            <Button type="submit" className="h-12 w-full" disabled={busy || !isValidUsername(name)}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Lock it in"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setChoosing(false)}>
              Back
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
