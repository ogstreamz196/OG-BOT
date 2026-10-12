import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getVipPassStatus } from "@/lib/vip-pass.functions";
import { Crown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

const PERKS = [
  ["🤬", "Foul Mouth OG Bot", "Unfiltered roasts & UK slang — amp it up to Demon level"],
  ["🌍", "Any language", "Chat in 29 languages (free for everyone, forever)"],
  ["⚡", "Priority AI", "Fast-lane replies and song writing"],
  ["🪙", "Daily safety net", "10 free coins a day if you run low"],
  ["🖼️", "Free image edits", "1 free private-chat edit every 4 hours"],
  ["👑", "Gold VIP badge", "Stand out in Battle Zone and releases"],
] as const;

function fmt(ms: number) {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

/** Starts the one-time 15-day trial and shows a once-per-day celebration popup. */
export function VipTrialWelcome() {
  const { user } = useAuth();
  const { isTrial, trialEndsAt, isAdmin, hasVipRole } = useRole();
  const qc = useQueryClient();
  const started = useRef(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const getVault = useServerFn(getVipPassStatus);
  const vault = useQuery({
    queryKey: ["vip-pass-status"],
    queryFn: () => getVault(),
    enabled: open,
  });

  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    void supabase.rpc("start_vip_trial_once" as never).then(({ data }) => {
      if ((data as { started?: boolean } | null)?.started) {
        void qc.invalidateQueries({ queryKey: ["profile"] });
      }
    });
  }, [user, qc]);

  useEffect(() => {
    if (!user || !isTrial || isAdmin || hasVipRole) return;
    const key = `og_vip_trial_seen_${user.id}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      /* private mode: show anyway */
    }
    setOpen(true);
  }, [user, isTrial, isAdmin, hasVipRole]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const ms = trialEndsAt ? Math.max(0, new Date(trialEndsAt).getTime() - now) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-coin/40 sm:max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-coin/20 text-coin shadow-lg">
            <Crown className="h-7 w-7" />
          </span>
          <DialogTitle className="mt-3 font-display text-xl uppercase">
            You've got 15 days of free OG VIP
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm">
            Your upgraded membership is live. Here's everything unlocked:
          </DialogDescription>
          <div className="mt-3 rounded-xl border border-coin/40 bg-coin/10 px-4 py-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-coin">
              VIP time left
            </div>
            <div className="font-mono text-2xl font-black tabular-nums">{fmt(ms)}</div>
          </div>
        </div>
        <ul className="mt-2 space-y-2">
          {PERKS.map(([icon, title, body]) => (
            <li key={title} className="flex gap-3 rounded-lg border border-border bg-card/60 p-2">
              <span className="text-xl" aria-hidden>
                {icon}
              </span>
              <span className="text-left">
                <span className="block text-sm font-bold">{title}</span>
                <span className="block text-xs text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 rounded-xl border border-coin/50 bg-coin/10 p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-coin">
            🔐 Bonus · OG Vault Access Pass
          </div>
          <div className="mt-1 text-sm">
            <span className="mr-2 text-muted-foreground line-through">Paid item</span>
            <span className="font-black text-coin">FREE for a limited time</span>
          </div>
          {vault.data?.username ? (
            <div className="mt-2 space-y-1 font-mono text-xs">
              <div>
                Pass code: <b>{vault.data.username}</b>
              </div>
              <div>
                PIN: <b>{vault.data.password}</b>
              </div>
            </div>
          ) : null}
          <Button asChild size="sm" variant="outline" className="mt-2 w-full" onClick={() => setOpen(false)}>
            <a href="/buy-coins#item-og-vip-pass">Open my Vault pass</a>
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <Button onClick={() => setOpen(false)} className="w-full">
            Let's cook 🔥
          </Button>
          <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
            <Link to="/buy-coins">Keep VIP after the trial</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
