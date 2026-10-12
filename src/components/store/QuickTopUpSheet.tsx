import { useState } from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  createCoinCheckoutSession,
  createCustomCoinCheckoutSession,
} from "@/lib/payments.functions";
import { CURRENCY_SYMBOL, COIN_PACKS, CUSTOM_COIN_UNIT } from "@/lib/coin-packs";
import { purchaseStoreName } from "@/lib/revenuecat";
import { useRevenueCat } from "@/components/revenuecat/RevenueCatProvider";
import { cn } from "@/lib/utils";

/** Packs offered in the quick sheet: the 99p starter plus the two small packs. */
const QUICK_PACKS = COIN_PACKS.slice(0, 2);

/**
 * Small "you're a few coins short" sheet. Opens right where the user is —
 * their prompt, styles and settings stay untouched behind it.
 */
export function QuickTopUpSheet({
  open,
  onOpenChange,
  needed,
  balance,
  reason,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Coins the blocked action costs. */
  needed: number;
  /** The user's current balance. */
  balance: number;
  /** What they were trying to do, e.g. "finish this track". */
  reason?: string;
}) {
  const navigate = useNavigate();
  const rc = useRevenueCat();
  const native = Capacitor.isNativePlatform();
  const [busy, setBusy] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const createCoinCheckout = useServerFn(createCoinCheckoutSession);
  const createCustomCheckout = useServerFn(createCustomCoinCheckoutSession);

  const short = Math.max(0, Math.ceil(needed - balance));

  async function buyNative(productId: string) {
    if (rc.loading) {
      toast.info(`Connecting to ${purchaseStoreName()}…`);
      return;
    }
    const pkg = rc.offerings?.current?.availablePackages.find((p) => {
      const a = p as unknown as {
        identifier: string;
        product?: { identifier?: string };
        webBillingProduct?: { identifier?: string };
      };
      const pid = (a.product?.identifier ?? a.webBillingProduct?.identifier ?? "").split(":")[0];
      return a.identifier === productId || pid === productId;
    });
    if (!pkg) {
      toast.error(
        `This pack isn't available from ${purchaseStoreName()} yet — please try again soon.`,
      );
      return;
    }
    const ok = await rc.purchasePackage(pkg);
    if (ok) {
      toast.success("Coins added — carry on where you left off.");
      onOpenChange(false);
    }
  }

  async function buy(kind: "starter" | string) {
    setBusy(kind);
    try {
      if (native) {
        await buyNative(kind === "starter" ? "coins_5" : kind);
        return;
      }
      const returnUrl = `${window.location.origin}/buy-coins/return?session_id={CHECKOUT_SESSION_ID}&pack=${
        kind === "starter" ? "coins_custom" : kind
      }`;
      const env = getStripeEnvironment();
      const res =
        kind === "starter"
          ? await createCustomCheckout({ data: { units: 1, returnUrl, environment: env } })
          : await createCoinCheckout({
              data: { priceId: `${kind}_gbp`, returnUrl, environment: env },
            });
      if ("error" in res && res.error) throw new Error(res.error);
      const secret = (res as { clientSecret?: string }).clientSecret ?? null;
      if (!secret) throw new Error("Checkout unavailable right now");
      setClientSecret(secret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <StripeCheckoutDialog clientSecret={clientSecret} onClose={() => setClientSecret(null)} />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-xl font-black">
              <Coins className="h-5 w-5 text-coin" />
              {short > 0 ? `${short} more coin${short === 1 ? "" : "s"} needed` : "Top up"}
            </DialogTitle>
            <DialogDescription>
              {reason ? `You need ${needed} coins to ${reason}. ` : ""}
              You have {balance}. Grab coins here and pick up right where you left off — nothing you
              typed is lost.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void buy("starter")}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-left transition hover:bg-primary/15",
                busy && "opacity-60",
              )}
            >
              <span>
                <span className="flex items-center gap-1.5 text-sm font-black">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {CUSTOM_COIN_UNIT.coins} OG Coins
                </span>
                <span className="text-xs text-muted-foreground">Quickest top-up</span>
              </span>
              <span className="flex items-center gap-2 text-sm font-black tabular-nums">
                {busy === "starter" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {CURRENCY_SYMBOL}
                {(CUSTOM_COIN_UNIT.priceCents / 100).toFixed(2)}
              </span>
            </button>

            {QUICK_PACKS.map((p) => (
              <button
                key={p.bundleId}
                type="button"
                disabled={busy !== null}
                onClick={() => void buy(p.bundleId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3 text-left transition hover:border-primary/40",
                  busy && "opacity-60",
                )}
              >
                <span>
                  <span className="text-sm font-black">{p.coins} OG Coins</span>
                  <span className="block text-xs text-muted-foreground">{p.label} pack</span>
                </span>
                <span className="flex items-center gap-2 text-sm font-black tabular-nums">
                  {busy === p.bundleId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {CURRENCY_SYMBOL}
                  {(p.priceCents / 100).toFixed(2)}
                </span>
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate({ to: "/store", search: {} });
            }}
          >
            See all packs in the Store
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
