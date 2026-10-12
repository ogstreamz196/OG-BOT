import { useState } from "react";
import {
  Coins,
  Download,
  Music2,
  Sparkles,
  Loader2,
  CreditCard,
  ArrowLeft,
  Lock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { arePaymentsEnabled, getStripeEnvironment } from "@/lib/stripe";
import { Capacitor } from "@capacitor/core";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createTrackUnlockCheckoutSession } from "@/lib/payments.functions";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";

/** One-off card price shown in the UI. Must match TRACK_UNLOCK_PENCE server-side. */
const CARD_PRICE_LABEL = "99p";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
  cost: number;
  royalty: number;
  balance: number;
  songTitle?: string | null;
  /** Enables the "pay by card" option for this track. */
  songId?: string;
  includesSecondTake?: boolean;
};

export function UnlockConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  busy,
  cost,
  royalty,
  balance,
  songTitle,
  songId,
  includesSecondTake = false,
}: Props) {
  const [payByCard, setPayByCard] = useState(false);
  const [starting, setStarting] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const createCheckout = useServerFn(createTrackUnlockCheckoutSession);
  const burnt = Math.max(0, cost - royalty);
  const canAfford = balance >= cost;
  // Card checkout is web-only; app stores require their own billing.
  const cardAvailable =
    !!songId && arePaymentsEnabled() && !(typeof window !== "undefined" && Capacitor.isNativePlatform());

  const returnUrl =
    typeof window === "undefined"
      ? ""
      : (() => {
          const url = new URL(window.location.href);
          url.searchParams.set("track_unlock", "1");
          url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
          return decodeURIComponent(url.toString());
        })();

  return (
    <>
    <StripeCheckoutDialog clientSecret={clientSecret} onClose={() => setClientSecret(null)} />
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (!v) setPayByCard(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Unlock the full track
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {songTitle ? (
              <span className="font-medium text-foreground">{songTitle}</span>
            ) : (
              "This track"
            )}{" "}
            —{" "}
            {payByCard
              ? `pay ${CARD_PRICE_LABEL} once to unlock and download the full studio version.`
              : "choose how you'd like to pay for the full studio version."}
          </DialogDescription>
        </DialogHeader>

        {includesSecondTake && (
          <div className="border-l-4 border-primary bg-primary/10 px-4 py-3">
            <p className="text-base font-bold text-foreground">2 tracks for the price of 1</p>
            <p className="mt-1 text-sm text-muted-foreground">Unlock this track and get Take 2 free in your library. No extra coins or card payment.</p>
          </div>
        )}

        {payByCard ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/30 p-6 text-center">
              <CreditCard className="mb-2 h-8 w-8 text-primary" />
              <p className="mb-4 text-sm text-muted-foreground">
                One-off payment · Card, Apple Pay or Google Pay. No coins needed.
              </p>
              <Button
                className="w-full"
                disabled={starting || !songId}
                onClick={async () => {
                  if (!songId) return;
                  setStarting(true);
                  try {
                    const res = await createCheckout({
                      data: { songId, returnUrl, environment: getStripeEnvironment() },
                    });
                    if ("error" in res && res.error) throw new Error(res.error);
                    const secret = (res as { clientSecret?: string }).clientSecret;
                    if (!secret) throw new Error("Checkout unavailable right now");
                    setClientSecret(secret);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Checkout failed");
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                {starting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                Pay {CARD_PRICE_LABEL} securely
              </Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setPayByCard(false)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to payment options
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Music2 className="h-4 w-4 text-muted-foreground" />
                  <span>Preview → Full HQ download</span>
                </div>
                <div className="flex items-center gap-1 text-sm font-semibold text-coin">
                  <Coins className="h-4 w-4" /> {cost} coins
                </div>
              </div>
              {royalty > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Includes <strong className="text-foreground">{royalty}</strong> coin royalty to
                  the original creator · {burnt} burnt.
                </p>
              )}
            </div>

            {/* Balance */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
              <span className="text-muted-foreground">Your balance</span>
              <span className="font-semibold">
                {balance} →{" "}
                <span className={canAfford ? "text-coin" : "text-destructive"}>
                  {balance - cost}
                </span>
              </span>
            </div>

            {/* Payment options — side by side */}
            <div className="grid grid-cols-2 gap-3">
              {/* Pay with Coins */}
               <Button
                 variant="outline"
                type="button"
                onClick={onConfirm}
                disabled={busy || !canAfford}
                 className="group relative h-auto min-h-40 flex-col gap-2 rounded-lg border-2 border-primary/30 bg-primary/5 p-4 text-center transition hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/15">
                  <Coins className="h-5 w-5 text-primary" />
                </div>
                <div className="text-sm font-bold text-foreground">Pay with Coins</div>
                <div className="flex items-center gap-1 text-lg font-black text-primary">
                  {cost}
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    coins
                  </span>
                </div>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Download className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                )}
               </Button>

              {/* Pay by Card */}
               <Button
                 variant="outline"
                type="button"
                onClick={() => setPayByCard(true)}
                disabled={busy || !cardAvailable}
                 className="group relative h-auto min-h-40 flex-col gap-2 rounded-lg border-2 border-foreground/15 bg-card p-4 text-center transition hover:border-foreground/30 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground/10">
                  <CreditCard className="h-5 w-5 text-foreground" />
                </div>
                <div className="text-sm font-bold text-foreground">Pay by Card</div>
                <div className="text-lg font-black text-foreground">{CARD_PRICE_LABEL}</div>
                {cardAvailable ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Unavailable
                  </span>
                )}
               </Button>
            </div>

            {/* Insufficient coins note */}
            {!canAfford && (
              <p className="text-center text-xs text-destructive">
                {cardAvailable ? `Not enough coins — pay ${CARD_PRICE_LABEL} by card, or top up in the Store.` : "Not enough coins — top up in the Store."}
              </p>
            )}

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
