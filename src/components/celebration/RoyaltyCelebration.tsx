import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PartyPopper, Coins } from "lucide-react";

type Notice = {
  id: string;
  title: string;
  body: string | null;
  metadata: { coins?: number } | null;
};

const FOIL = [
  { shape: "coin", color: "#ffd166" },
  { shape: "coin", color: "#f4c430" },
  { shape: "star", color: "#ffffff" },
  { shape: "star", color: "#ffd166" },
  { shape: "diamond", color: "#06d6a0" },
  { shape: "diamond", color: "#ff2d2d" },
] as const;

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 64 }, (_, i) => {
        const f = FOIL[i % FOIL.length];
        const size = f.shape === "coin" ? 9 + Math.random() * 7 : 8 + Math.random() * 9;
        return {
          id: i,
          shape: f.shape,
          left: Math.random() * 100,
          delay: Math.random() * 1.4,
          duration: 2.6 + Math.random() * 2.2,
          size,
          sway: `${(Math.random() * 60 - 30).toFixed(0)}px`,
          // Coins read as metal discs; stars and diamonds are flat foil.
          background:
            f.shape === "coin"
              ? `radial-gradient(circle at 35% 30%, #fff, ${f.color} 55%, #9a6a12)`
              : f.color,
          glow: f.shape === "coin" ? `0 0 6px ${f.color}` : undefined,
        };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`royalty-foil royalty-foil--${p.shape}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.background,
            boxShadow: p.glow,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ["--sway" as string]: p.sway,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Listens (realtime) for creator notifications — e.g. someone downloaded their
 * track and they earned loyalty OG coins — and pops a victory celebration.
 */
export function RoyaltyCelebration({ userId }: { userId: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`royalty-notify:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Notice & { kind: string };
          if (row.kind === "track_download") setNotice(row);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const close = useCallback(() => {
    if (notice) {
      supabase
        .from("user_notifications" as never)
        .update({ read: true } as never)
        .eq("id", notice.id)
        .then(() => undefined);
    }
    setNotice(null);
  }, [notice]);

  return (
    <Dialog open={!!notice} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm overflow-hidden border-primary/50 bg-card text-center shadow-[0_0_80px_-12px_oklch(0.7_0.22_25/0.7)]">
        <Confetti />
        <span aria-hidden className="royalty-shockwave" />
        <DialogHeader className="relative items-center !text-center">
          <span className="mb-1 grid h-16 w-16 animate-bounce place-items-center rounded-full bg-primary/15 ring-2 ring-primary/60">
            <PartyPopper className="h-8 w-8 text-primary" />
          </span>
          <DialogTitle className="text-balance text-2xl font-black uppercase tracking-wide text-primary drop-shadow-[0_0_18px_oklch(0.7_0.22_25/0.8)]">
            {notice?.title ?? "Victory!"}
          </DialogTitle>
          <DialogDescription className="text-pretty text-sm leading-relaxed">
            {notice?.body}
          </DialogDescription>
        </DialogHeader>
        {typeof notice?.metadata?.coins === "number" && (
          <div className="relative mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-300/50 bg-amber-400/10 px-4 py-2 text-sm font-black uppercase tracking-widest text-amber-200">
            <Coins className="h-4 w-4" />+{notice.metadata.coins} loyalty OG coin
          </div>
        )}
        <button
          type="button"
          onClick={close}
          className="relative mx-auto mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-black uppercase tracking-widest text-primary-foreground transition-transform hover:scale-105 active:scale-95"
        >
          Let&apos;s go!
        </button>
      </DialogContent>
    </Dialog>
  );
}
