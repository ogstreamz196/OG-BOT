import { useEffect, useState } from "react";
import { Flame, Sparkles, Timer, Music4 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HYPE = [
  "Booking the session…",
  "Warming up the vocal booth…",
  "Writing your hook…",
  "Tracking the vocals…",
  "Mixing the low end…",
  "Mastering for the speakers…",
];

/**
 * Celebration + expectation-setting popup shown the moment the wizard is
 * submitted. Everything runs in the backend, so the goal here is to make the
 * wait feel like a studio session rather than a loading screen.
 */
export function CookingDialog({
  open,
  onOpenChange,
  title,
  etaMinutes = 5,
  safeToLeave = true,
}: {
  safeToLeave?: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  etaMinutes?: number;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setTick(0);
    const id = window.setInterval(() => setTick((t) => t + 1), 2200);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border-primary/30 bg-card/95 backdrop-blur-xl">
        {/* Crimson glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-primary/25 blur-[90px]"
        />
        <DialogHeader className="items-center text-center">
          <div className="relative mb-2 grid h-20 w-20 place-items-center rounded-full border border-primary/40 bg-primary/10 shadow-glow">
            <Flame className="h-9 w-9 animate-pulse text-primary" />
            <span
              aria-hidden
              className="absolute inset-0 animate-ping rounded-full border border-primary/30"
            />
          </div>
          <DialogTitle className="font-display text-2xl font-black leading-tight sm:text-3xl">
            It&apos;s cooking 🔥
          </DialogTitle>
          <DialogDescription className="text-sm">
            {title ? (
              <>
                <span className="font-bold text-foreground">{title}</span> is in the booth. Usually{" "}
                {etaMinutes} minutes — sometimes longer. We'll tell you the moment it lands.
              </>
            ) : (
              <>Your track is in the booth. Usually {etaMinutes} minutes — sometimes longer.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Live hype ticker + bouncing bars */}
        <div className="mt-2 rounded-2xl border border-white/10 bg-background/50 p-4">
          <div className="flex items-center gap-3">
            <div aria-hidden className="flex h-6 items-end gap-[3px]">
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  key={i}
                  className="studio-vu-bar w-[3px] rounded-full bg-gradient-to-t from-primary/50 to-primary"
                  style={{
                    height: `${35 + ((i * 41) % 65)}%`,
                    animationDelay: `${(i * 0.11).toFixed(2)}s`,
                    animationDuration: `${(0.8 + ((i * 7) % 6) / 10).toFixed(2)}s`,
                  }}
                />
              ))}
            </div>
            <p
              key={tick}
              className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wider text-primary"
            >
              {HYPE[tick % HYPE.length]}
            </p>
          </div>
        </div>

        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Timer className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Full-length render, not a 20 second demo — so it can run past the estimate.
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {safeToLeave
              ? "You can close this page. Your track keeps rendering in the background."
              : "Keep this page open for a few seconds while lyrics are written — then you can close it."}
          </li>
          <li className="flex items-start gap-2">
            <Music4 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            We&apos;ll pop a &ldquo;track ready&rdquo; message the second the sample lands.
          </li>
        </ul>

        <Button
          onClick={() => onOpenChange(false)}
          className={cn(
            "mt-4 w-full bg-gradient-brand font-black uppercase tracking-wide text-primary-foreground",
          )}
        >
          Watch it cook
        </Button>
      </DialogContent>
    </Dialog>
  );
}
