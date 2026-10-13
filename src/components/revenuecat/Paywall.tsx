import { useEffect, useState } from "react";
import { Check, Crown, Loader2, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { useRevenueCat } from "./RevenueCatProvider";
import { showCustomerCenter, restorePurchases } from "@/lib/revenuecat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Apple guideline 3.1.2(a) requires auto-renew billing terms plus links to the
 * privacy policy and terms of use on the paywall itself. Guideline 3.1.1
 * requires a Restore Purchases control. Both are shown on every platform so the
 * website and the phone apps stay consistent.
 */
function SubscriptionLegal({ storeName }: { storeName: string }) {
  return (
    <div className="mt-5 space-y-2 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground">
      <p>
        Payment is charged to your {storeName} account at confirmation of purchase. The subscription
        renews automatically at the same price unless you cancel at least 24 hours before the end of
        the current period. Your account is charged for renewal within 24 hours of the period
        ending. Manage or cancel your subscription in your {storeName} account settings after
        purchase.
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <Link to="/terms" className="font-semibold text-primary underline-offset-4 hover:underline">
          Terms of Use
        </Link>
        <Link
          to="/policy"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}

function RestoreButton() {
  const { refreshInfo } = useRevenueCat();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const info = await restorePurchases();
          await refreshInfo();
          const active = info?.entitlements?.active ?? {};
          toast[Object.keys(active).length > 0 ? "success" : "info"](
            Object.keys(active).length > 0
              ? "Purchases restored."
              : "No previous purchases found for this account.",
          );
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't restore purchases.");
        } finally {
          setBusy(false);
        }
      }}
      className="text-xs text-muted-foreground"
    >
      {busy ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
      )}
      Restore purchases
    </Button>
  );
}

function useStoreName() {
  const [name, setName] = useState("your store");
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) setName("your payment");
    else setName(Capacitor.getPlatform() === "ios" ? "Apple ID" : "Google Play");
  }, []);
  return name;
}

const MONTHLY_PLAN = {
  title: "OG VIP Monthly",
  price: "£4.99",
  period: "/month",
  description: "Full VIP access, billed monthly. Cancel any time.",
};

const YEARLY_PLAN = {
  title: "VIP Yearly",
  price: "£50",
  period: "/year",
  description: "Full VIP access for a whole year — two months free versus monthly.",
};

export function Paywall() {
  const { offerings, loading, purchasePackage, isVip } = useRevenueCat();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const storeName = useStoreName();

  const rawOffering = offerings?.current;
  // The Current offering also holds coin packs (coins_*, track_unlock_99p); the VIP paywall shows only subscriptions.
  const currentOffering = rawOffering
    ? {
        ...rawOffering,
        availablePackages: rawOffering.availablePackages.filter((p) => {
          const a = p as unknown as {
            identifier: string;
            product?: { identifier?: string };
            webBillingProduct?: { identifier?: string };
          };
          const id = `${a.identifier} ${a.product?.identifier ?? ""} ${a.webBillingProduct?.identifier ?? ""}`;
          return !/coins_|track_unlock/.test(id);
        }),
      }
    : undefined;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscription details…
        </CardContent>
      </Card>
    );
  }

  if (isVip) {
    return (
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="h-4 w-4 text-primary" /> You are VIP
          </CardTitle>
          <CardDescription>Enjoy your premium features.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void showCustomerCenter()}>
              Manage subscription
            </Button>
            <RestoreButton />
          </div>
          <SubscriptionLegal storeName={storeName} />
        </CardContent>
      </Card>
    );
  }

  if (!currentOffering || currentOffering.availablePackages.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
          <p>No subscription packages available at the moment.</p>
          <RestoreButton />
        </CardContent>
      </Card>
    );
  }

  const handlePurchase = async (pkg: (typeof currentOffering.availablePackages)[number]) => {
    setPurchasing(pkg.identifier);
    try {
      const success = await purchasePackage(pkg);
      if (success) toast.success("Welcome to VIP!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Purchase failed or cancelled.");
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2 text-2xl">
          <Crown className="h-5 w-5 text-primary" /> Unlock OG VIP Pass
        </CardTitle>
        <CardDescription>Get unlimited access to all premium features.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {currentOffering.availablePackages.map((pkg) => {
            // Google Play product IDs: og_vip_monthly / og_vip_yearly (native),
            // web billing product, or RevenueCat package identifiers ($rc_annual).
            const anyPkg = pkg as unknown as {
              identifier: string;
              product?: { identifier?: string };
              webBillingProduct?: { identifier?: string };
            };
            const productId =
              anyPkg.product?.identifier ?? anyPkg.webBillingProduct?.identifier ?? "";
            const isYearly =
              productId.startsWith("og_vip_yearly") ||
              /year|annual/i.test(`${pkg.identifier} ${productId}`);
            const busy = purchasing === pkg.identifier;
            const plan = isYearly ? YEARLY_PLAN : MONTHLY_PLAN;
            return (
              <div
                key={pkg.identifier}
                className={cn(
                  "flex flex-col rounded-2xl border p-5",
                  isYearly ? "border-primary/60 bg-primary/10" : "border-border bg-card",
                )}
              >
                {isYearly && (
                  <Badge className="mb-2 w-fit bg-gradient-brand text-primary-foreground shadow-glow">
                    Best value
                  </Badge>
                )}
                <h3 className="text-lg font-bold">{plan.title}</h3>
                <div className="mb-1 text-2xl font-black">
                  {plan.price}
                  <span className="text-sm font-semibold text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mb-5 flex-grow text-sm text-muted-foreground">{plan.description}</p>

                <Button
                  disabled={purchasing !== null}
                  onClick={() => void handlePurchase(pkg)}
                  className={cn(
                    "w-full",
                    isYearly && "bg-gradient-brand text-primary-foreground shadow-glow",
                  )}
                  variant={isYearly ? "default" : "outline"}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {busy ? "Processing…" : `Subscribe ${isYearly ? "yearly" : "monthly"}`}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-center">
          <RestoreButton />
        </div>
        <SubscriptionLegal storeName={storeName} />
      </CardContent>
    </Card>
  );
}
