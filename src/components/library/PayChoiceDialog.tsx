import { Link } from "@tanstack/react-router";
import { Coins, CreditCard, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * Last step before a track cooks: pay with OG coins or £0.99 by card. Either
 * way the track comes out fully unlocked (download, share, edit).
 */
export function PayChoiceDialog({
  open,
  onOpenChange,
  title,
  coinCost,
  balance,
  cardAvailable,
  busy,
  onCoins,
  onCard,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  coinCost: number;
  balance: number;
  /** Card checkout (website only; app stores require their own billing). */
  cardAvailable: boolean;
  busy: "coins" | "card" | null;
  onCoins: () => void;
  onCard: () => void;
}) {
  const enough = balance >= coinCost;
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md border-destructive/30 bg-card">
        <DialogTitle className="font-display text-2xl font-black">
          Cook your master track
        </DialogTitle>
        <DialogDescription className="text-sm text-foreground/85">
          <span className="font-bold text-foreground">{title || "Your track"}</span> — full-length
          track with real vocals. Pick how to pay, then it starts cooking.
        </DialogDescription>

        <div className="mt-2 grid gap-3">
          <button
            type="button"
            disabled={!enough || busy !== null}
            onClick={onCoins}
            className="flex min-h-16 items-center gap-3 rounded-2xl border border-amber-300/50 bg-amber-500/10 px-4 text-left transition hover:bg-amber-500/15 disabled:opacity-55"
          >
            {busy === "coins" ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-300" />
            ) : (
              <Coins className="h-5 w-5 shrink-0 text-amber-300" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-black uppercase tracking-wide">
                Pay {coinCost} OG coins
              </span>
              <span className="block text-xs text-muted-foreground">
                {enough
                  ? `You have ${balance}. ${balance - coinCost} left after.`
                  : `You have ${balance}. Need ${coinCost - balance} more.`}
              </span>
            </span>
          </button>
          {!enough ? (
            <Link
              to="/store"
              className="-mt-1 text-center text-xs font-bold text-amber-300 underline underline-offset-4"
            >
              Top up coins in the OG Store
            </Link>
          ) : null}

          {cardAvailable ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={onCard}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-destructive/50 bg-destructive/10 px-4 text-left transition hover:bg-destructive/15 disabled:opacity-55"
            >
              {busy === "card" ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-destructive" />
              ) : (
                <CreditCard className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-black uppercase tracking-wide">Pay £0.99 by card</span>
                <span className="block text-xs text-muted-foreground">
                  Card, Apple Pay or Google Pay. Coins stay untouched.
                </span>
              </span>
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Either way you can play, download, share and edit it when it's ready.
        </p>
      </DialogContent>
    </Dialog>
  );
}
