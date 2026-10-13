import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  Coins,
  Check,
  ArrowLeft,
  Crown,
  Zap,
  ShieldCheck,
  Lock,
  Sparkles,
  Infinity as InfinityIcon,
  TrendingDown,
  Pencil,
  X,
  Loader2,
  CreditCard,
  Plus,
  Minus,
  SlidersHorizontal,
  Store,
  Tag,
  ToggleLeft,
  ToggleRight,
  Gem,
  Trophy,
  Flame,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { EditableContent } from "@/components/admin/EditableContent";
import { useAdminEditMode, AdminEditModeToggle } from "@/components/admin/AdminEditMode";
import { useServerFn } from "@tanstack/react-start";
import {
  createCoinCheckoutSession,
  createVipCheckoutSession,
  createCustomCoinCheckoutSession,
} from "@/lib/payments.functions";
import { Capacitor } from "@capacitor/core";
import { useRevenueCat } from "@/components/revenuecat/RevenueCatProvider";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";
import { getStripeEnvironment } from "@/lib/stripe";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { useSiteContent, useSetSiteContent } from "@/hooks/use-site-content";
import { cn } from "@/lib/utils";
import {
  COIN_PACKS,
  CURRENCY_SYMBOL,
  VIP_PLAN,
  VIP_PLAN_YEARLY,
  getVipPlan,
  CUSTOM_COIN_UNIT,
  applyPackOverride,
  parsePackOverride,
  packOverrideKey,
  packShowsBonus,
  type CoinPack,
  type PackOverride,
} from "@/lib/coin-packs";
import {
  loadStoredSelection,
  persistSelection,
  clearStoredSelection,
  type Selection,
} from "@/lib/buy-coins-selection";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

import { toast } from "sonner";
import { PurchaseHistory } from "@/components/PurchaseHistory";
import { ReferralReminder } from "@/components/referrals/ReferralReminder";
import { StoreItemsSection } from "@/components/store/StoreItemsSection";

export const Route = createFileRoute("/_authenticated/buy-coins/")({
  validateSearch: (s: Record<string, unknown>): { edit?: 1 } =>
    s.edit === "1" || s.edit === 1 || s.edit === true ? { edit: 1 } : {},
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/store", search: { edit: search.edit } });
  },
  head: () => ({
    meta: [
      { title: "OG Coins & VIP — OG BOT Store" },
      {
        name: "description",
        content: "Buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:title", content: "OG Coins & VIP — OG BOT Store" },
      {
        property: "og:description",
        content: "Buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BuyCoinsPage,
});

function BuyCoinsPage() {
  const search = Route.useSearch();
  return <CoinStore editMode={search.edit} />;
}

export function CoinStore({ editMode }: { editMode?: 1 }) {
  const { data: profile } = useProfile();
  const rc = useRevenueCat();
  const rcLoading = rc.loading;
  const rcPurchase = rc.purchasePackage;
  // Apple rejects any iOS build that mentions Google Play, so name the store the
  // device actually bills through.
  const [nativeStoreName, setNativeStoreName] = useState("the App Store");
  const [isNativeApp, setIsNativeApp] = useState(false);
  useEffect(() => {
    setNativeStoreName(Capacitor.getPlatform() === "ios" ? "the App Store" : "Google Play");
    setIsNativeApp(Capacitor.isNativePlatform());
  }, []);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const createVipCheckout = useServerFn(createVipCheckoutSession);
  const [noAutoRenew, setNoAutoRenew] = useState(false);
  const createCustomCheckout = useServerFn(createCustomCoinCheckoutSession);
  const createCoinCheckout = useServerFn(createCoinCheckoutSession);
  const { isVip, hasVipRole, isDev, isLoading: roleLoading } = useRole();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [stage, setStage] = useState<"confirm" | "pay">("confirm");

  // Friendly bounce if a non-dev/admin opens the page in edit mode
  // (e.g. shared `?edit=1` link). The actual edit gate is enforced
  // server-side and in <AdminEditModeProvider>; this just gives the
  // user a clear message instead of a silently inert UI.
  useEffect(() => {
    if (editMode !== 1) return;
    if (roleLoading) return; // wait for role resolution before deciding
    if (isDev) return; // dev/admin: leave them in edit mode
    toast.info("Edit mode is for the OG Studio team only — showing you the normal store view.", {
      duration: 4500,
    });
    navigate({ to: "/store", search: {}, replace: true });
  }, [editMode, isDev, roleLoading, navigate]);

  // Restore previous selection (e.g. after a canceled Stripe checkout).
  useEffect(() => {
    if (selected) return;
    const restored = loadStoredSelection();
    if (!restored) return;
    setSelected(restored);
    setStage("confirm");
    toast.info("We brought you back to your last selection.");
  }, [selected]);

  const pickSelection = (s: Selection) => {
    persistSelection(s);
    setSelected(s);
    setStage("confirm");
  };

  const clearSelection = () => {
    clearStoredSelection();
    setSelected(null);
    setStage("confirm");
  };

  // Anchor savings calc against the worst per-coin price (the smallest pack).
  const basePerCoin = COIN_PACKS.reduce((max, p) => Math.max(max, p.priceCents / 100 / p.coins), 0);

  if (selected) {
    const isVipFlow = selected.type === "vip";
    const vipPlan = getVipPlan(selected.type === "vip" ? selected.plan : undefined);
    const vipYearly = vipPlan.cadence === "year";
    const isCustomFlow = selected.type === "custom";
    const coinsForOrder = isVipFlow
      ? 0
      : isCustomFlow
        ? selected.units * CUSTOM_COIN_UNIT.coins
        : selected.pack.coins;
    const labelForOrder = isVipFlow
      ? vipPlan.label
      : isCustomFlow
        ? `Custom · ${coinsForOrder} OG Coins`
        : `${selected.pack.coins} OG Coins · ${selected.pack.label}`;
    const totalCents = isVipFlow
      ? vipPlan.priceCents
      : isCustomFlow
        ? selected.units * CUSTOM_COIN_UNIT.priceCents
        : selected.pack.priceCents;
    const returnUrlPack = isVipFlow
      ? vipPlan.bundleId
      : isCustomFlow
        ? "coins_custom"
        : selected.pack.bundleId;
    const returnUrl = `${window.location.origin}/buy-coins/return?session_id={CHECKOUT_SESSION_ID}&pack=${returnUrlPack}`;
    const headline = isVipFlow ? "Join OG VIP" : `Buy ${coinsForOrder} OG Coins`;
    const perCoin = !isVipFlow && coinsForOrder > 0 ? totalCents / 100 / coinsForOrder : 0;
    const savingsPct =
      !isVipFlow && basePerCoin > 0 && perCoin > 0
        ? Math.round((1 - perCoin / basePerCoin) * 100)
        : 0;

    return (
      <DashboardShell title={headline}>
        <StripeCheckoutDialog
          clientSecret={clientSecret}
          onClose={() => {
            setClientSecret(null);
            setCheckoutLoading(false);
          }}
        />
        <PaymentTestModeBanner />
        <div className="mx-auto max-w-2xl">
          <Button variant="ghost" className="mb-4 -ml-2" onClick={clearSelection}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to coin packs
          </Button>
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-br from-coin/15 via-card to-card px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-coin/20 text-coin shadow-glow">
                  {isVipFlow ? <Crown className="h-5 w-5" /> : <Coins className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Order summary
                  </p>
                  <p className="truncate text-base font-bold">{labelForOrder}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black tabular-nums leading-none sm:text-3xl">
                  {CURRENCY_SYMBOL}
                  {(totalCents / 100).toFixed(2)}
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isVipFlow ? (vipYearly ? "billed yearly" : "billed monthly") : "one-time"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-border/60 bg-background/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-5 sm:py-2.5">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Secure checkout
              </span>
              <span aria-hidden className="hidden sm:inline">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" />{" "}
                {Capacitor.isNativePlatform() ? nativeStoreName : "Apple / Google Pay"}
              </span>
            </div>
            {stage === "confirm" ? (
              <div className="p-5 sm:p-6">
                {/* Confirmation banner — extra prominent for custom builds */}
                <div
                  role="status"
                  aria-live="polite"
                  className={cn(
                    "relative overflow-hidden rounded-2xl border-2 p-4",
                    isCustomFlow
                      ? "border-red-500/50 bg-gradient-to-br from-[#1a0505] via-[#0b0202] to-[#170303] shadow-[0_0_40px_-10px_rgba(239,68,68,0.6)]"
                      : "border-emerald-500/40 bg-emerald-500/10",
                  )}
                >
                  {isCustomFlow && (
                    <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-red-500/25 blur-3xl animate-pulse" />
                  )}
                  <div className="relative flex items-start gap-3">
                    <div
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                        isCustomFlow
                          ? "border border-red-500/50 bg-red-500/15 text-red-300"
                          : "bg-emerald-500/20 text-emerald-300",
                      )}
                    >
                      {isCustomFlow ? <Flame className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">
                        {isCustomFlow
                          ? "Custom stack locked in"
                          : isVipFlow
                            ? "VIP plan selected"
                            : "Pack selected"}
                      </p>
                      <p className="mt-0.5 truncate font-display text-lg font-black text-white sm:text-xl">
                        {isVipFlow
                          ? vipPlan.label
                          : isCustomFlow
                            ? `${coinsForOrder} OG Coins`
                            : `${(selected as { pack: CoinPack }).pack.coins} OG Coins · ${(selected as { pack: CoinPack }).pack.label}`}
                      </p>
                      {!isVipFlow && (
                        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-white/60 tabular-nums">
                          {CURRENCY_SYMBOL}
                          {(totalCents / 100).toFixed(2)} · {CURRENCY_SYMBOL}
                          {perCoin.toFixed(3)} per coin
                          {savingsPct > 0 ? ` · save ${savingsPct}%` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Order summary
                </p>
                <div className="mt-2 grid gap-2 rounded-2xl border border-border bg-background/40 p-4 text-sm">
                  <Row
                    label={isVipFlow ? "Plan" : "Pack"}
                    value={
                      isVipFlow
                        ? vipPlan.label
                        : isCustomFlow
                          ? "Custom"
                          : (selected as { pack: CoinPack }).pack.label
                    }
                  />
                  {!isVipFlow && <Row label="Coins" value={`${coinsForOrder} OG Coins`} />}
                  {!isVipFlow && (
                    <Row
                      label="Per coin"
                      value={`${CURRENCY_SYMBOL}${perCoin.toFixed(3)}`}
                      hint={savingsPct > 0 ? `Save ${savingsPct}% vs smallest pack` : undefined}
                    />
                  )}
                  <Row
                    label="Billing"
                    value={
                      isVipFlow
                        ? vipYearly
                          ? "Yearly subscription"
                          : "Monthly subscription"
                        : "One-time payment"
                    }
                  />
                  <div className="mt-1 flex items-baseline justify-between border-t border-border/60 pt-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Total today
                    </span>
                    <span className="text-2xl font-black tabular-nums">
                      {CURRENCY_SYMBOL}
                      {(totalCents / 100).toFixed(2)}
                    </span>
                  </div>
                </div>

                {isVipFlow && (
                  <div className="mt-4 rounded-2xl border-2 border-coin/50 bg-coin/10 p-4 text-sm">
                    <p className="flex items-center gap-2 font-bold text-coin">
                      <ShieldCheck className="h-4 w-4" /> Cancel anytime
                    </p>
                    <p className="mt-1 text-foreground/90">
                      {vipYearly
                        ? `Cancel whenever you like. You'll still keep VIP and every perk until your full year is up (${new Date(Date.now() + 365 * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}). Renews yearly unless cancelled. You'll also get your own OG VIP ID.`
                        : "Cancel whenever you like. You'll keep VIP until the end of the month you've paid for. Renews monthly unless cancelled."}
                    </p>
                    {vipYearly && !Capacitor.isNativePlatform() && (
                      <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-coin/25 pt-3 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={noAutoRenew}
                          onChange={(e) => setNoAutoRenew(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-coin,currentColor)]"
                        />
                        <span>
                          <span className="font-semibold text-foreground">Don't auto-renew</span>{" "}
                          — pay once for the year. VIP stays on until it ends, with no renewal charge.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* Next steps — clear what happens next */}
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  What happens next
                </p>
                <ol className="mt-2 space-y-2">
                  <NextStep
                    n={1}
                    title="Continue to secure checkout"
                    body={
                      Capacitor.isNativePlatform()
                        ? `Billed securely through ${nativeStoreName}.`
                        : "Pay with card, Apple Pay, or Google Pay. PCI-compliant via Stripe."
                    }
                  />
                  <NextStep
                    n={2}
                    title={isVipFlow ? "VIP unlocks instantly" : "Coins land in your wallet"}
                    body={
                      isVipFlow
                        ? "All VIP perks activate the moment payment confirms."
                        : `${coinsForOrder} OG Coins credited within seconds — no waiting.`
                    }
                  />
                  <NextStep
                    n={3}
                    title={isVipFlow ? "Manage anytime in Settings" : "Start burning coins"}
                    body={
                      isVipFlow
                        ? "Cancel or change plan whenever you like."
                        : "Head to MusicHUB or Messenger and spend when ready. Coins never expire."
                    }
                  />
                </ol>

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={clearSelection} className="h-12 sm:h-10">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => setStage("pay")}
                    className="h-12 w-full bg-gradient-brand font-bold text-primary-foreground shadow-glow hover:opacity-90 sm:h-10 sm:w-auto"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Continue · {CURRENCY_SYMBOL}
                    {(totalCents / 100).toFixed(2)}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-5">
                <div className="flex flex-col items-center justify-center p-8 bg-muted/30 rounded-xl border border-border">
                  {checkoutLoading ? (
                    <div className="flex flex-col items-center text-muted-foreground gap-3">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <p>Redirecting to checkout...</p>
                    </div>
                  ) : (
                    <>
                      {Capacitor.isNativePlatform() ? (
                        <Button
                          className="w-full"
                          size="lg"
                          onClick={async () => {
                            if (rcLoading) {
                              toast.info(`Connecting to ${nativeStoreName}...`);
                              return;
                            }
                            try {
                              if (isCustomFlow && coinsForOrder !== 5) {
                                toast.error(
                                  "Custom amounts are only on ogbot.co.uk. In the app, pick one of the coin packs.",
                                );
                                return;
                              }
                              setCheckoutLoading(true);
                              const targetId = isVipFlow
                                ? vipPlan.bundleId
                                : isCustomFlow
                                  ? "coins_5"
                                  : selected.pack.bundleId;

                              // Match by package id or Google Play product id (coins_50, coins_100, coins_240, coins_600).
                              const currentOffering = rc.offerings?.current;
                              const pkg = currentOffering?.availablePackages.find((p) => {
                                const a = p as unknown as {
                                  identifier: string;
                                  product?: { identifier?: string };
                                  webBillingProduct?: { identifier?: string };
                                };
                                const pid = (
                                  a.product?.identifier ??
                                  a.webBillingProduct?.identifier ??
                                  ""
                                ).split(":")[0];
                                return a.identifier === targetId || pid === targetId;
                              });

                              if (!pkg) {
                                toast.error(
                                  `${nativeStoreName} doesn't have this product yet — it becomes available once the app release is live.`,
                                );
                                setCheckoutLoading(false);
                                return;
                              }

                              const success = await rcPurchase(pkg);
                              if (success) {
                                toast.success(
                                  "Purchase successful! Your account has been credited.",
                                );
                                navigate({ to: "/store" });
                              }
                            } catch (e) {
                              toast.error((e as Error).message || "Purchase failed or cancelled.");
                            } finally {
                              setCheckoutLoading(false);
                            }
                          }}
                        >
                          Purchase via {nativeStoreName}
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          size="lg"
                          onClick={async () => {
                            setCheckoutLoading(true);
                            try {
                              const returnUrlPack = isVipFlow
                                ? vipPlan.bundleId
                                : isCustomFlow
                                  ? "coins_custom"
                                  : selected.pack.bundleId;

                              const returnUrl = `${window.location.origin}/buy-coins/return?session_id={CHECKOUT_SESSION_ID}&pack=${returnUrlPack}`;

                              let res;
                              if (isVipFlow) {
                                res = await createVipCheckout({
                                  data: {
                                    returnUrl,
                                    environment: getStripeEnvironment(),
                                    plan: vipYearly ? "yearly" : "monthly",
                                    noAutoRenew: vipYearly && noAutoRenew,
                                  },
                                });
                              } else if (isCustomFlow) {
                                res = await createCustomCheckout({
                                  data: {
                                    units: coinsForOrder / CUSTOM_COIN_UNIT.coins,
                                    returnUrl,
                                    environment: getStripeEnvironment(),
                                  },
                                });
                              } else {
                                res = await createCoinCheckout({
                                  data: {
                                    priceId: selected.pack.priceId,
                                    returnUrl,
                                    environment: getStripeEnvironment(),
                                  },
                                });
                              }

                              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
                              const r = res as any;
                              if (r.error) throw new Error(r.error);
                              if (r.url) window.location.href = r.url;
                              else if (r.clientSecret) setClientSecret(r.clientSecret);
                              else throw new Error("Checkout could not start.");
                            } catch (e) {
                              toast.error((e as Error).message || "Failed to start checkout.");
                              setCheckoutLoading(false);
                            }
                          }}
                        >
                          <CreditCard className="mr-2 h-4 w-4" />
                          Checkout securely with Stripe
                        </Button>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  disabled={checkoutLoading}
                  onClick={() => setStage("confirm")}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                >
                  ← Change selection
                </button>
              </div>
            )}
          </div>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Store">
      <PaymentTestModeBanner />
      <div className="store-clean mx-auto w-full max-w-6xl space-y-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:space-y-8">
        <section className="overflow-hidden rounded-xl border border-border bg-store-card p-4 shadow-card sm:p-6">
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_auto] min-[360px]:items-center min-[360px]:gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">OG BOT Store</p>
              <h1 className="mt-1 max-w-[13rem] font-display text-xl font-black leading-tight min-[390px]:max-w-none sm:text-3xl">
                <EditableContent contentKey="buyCoins.heading" defaultValue="Stock up. Power up." />
              </h1>
            </div>
            <div
              role="status"
              aria-label={`Wallet balance ${profile?.coin_balance ?? 0} OG coins`}
              className="text-left min-[360px]:text-right"
            >
              <p className="text-xs font-semibold uppercase text-muted-foreground">Balance</p>
              <div className="mt-1 flex items-center justify-start gap-2 min-[360px]:justify-end">
                <Coins className="h-5 w-5 text-primary" />
                <span className="font-mono text-xl font-bold tabular-nums sm:text-2xl">
                  {profile?.coin_balance ?? 0}
                </span>
                <span className="hidden text-xs text-muted-foreground min-[360px]:inline">OG</span>
              </div>
            </div>
          </div>
          <ReferralReminder className="mt-4 border-border bg-background/45 shadow-none" />
          {isDev ? (
            <div className="mt-3 flex justify-end">
              <AdminEditModeToggle />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="section-bundles" className="scroll-mt-24">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                One-time purchase
              </p>
              <h2 id="section-bundles" className="font-display text-xl font-black">
                Coin packs
              </h2>
            </div>
            <span className="shrink-0 rounded-md bg-coin/15 px-2 py-1 text-xs font-bold text-coin">
              Save up to{" "}
              {Math.round(
                (1 -
                  COIN_PACKS[COIN_PACKS.length - 1].priceCents /
                    100 /
                    COIN_PACKS[COIN_PACKS.length - 1].coins /
                    basePerCoin) *
                  100,
              )}
              %
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {COIN_PACKS.map((t, i) => (
              <PackCard
                key={t.bundleId}
                pack={t}
                tierIndex={i}
                totalTiers={COIN_PACKS.length}
                basePerCoin={basePerCoin}
                onBuy={(effective) => pickSelection({ type: "coins", pack: effective })}
              />
            ))}
          </div>
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Secure checkout · Apple Pay · Google Pay · Card
          </p>
        </section>

        <section aria-labelledby="section-custom" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 id="section-custom" className="font-display text-lg font-black">
              Need a different amount?
            </h2>
          </div>
          <CustomPackCard onBuy={(units) => pickSelection({ type: "custom", units })} />
        </section>
        <StoreItemsSection />

        <section aria-labelledby="section-vip" className="scroll-mt-24">
          <div className="overflow-hidden rounded-2xl border border-coin/40 bg-store-card shadow-card">
            {/* Hero */}
            <div className="relative bg-gradient-to-br from-coin/25 via-coin/5 to-transparent p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-coin">
                    OG VIP membership
                  </p>
                  <h2
                    id="section-vip"
                    className="mt-1 font-display text-2xl font-black leading-tight"
                  >
                    {hasVipRole ? "You're VIP 👑" : "Unlock everything."}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                    {hasVipRole
                      ? "All styles, foul-mouth mode and 13% cashback are yours."
                      : "Every style, unfiltered OG Bot, gold status and double cashback."}
                  </p>
                </div>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-coin/20 ring-1 ring-coin/50">
                  <Crown className="h-6 w-6 text-coin" />
                </div>
              </div>
              {hasVipRole && profile?.og_vip_id ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-coin/50 bg-background/60 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">
                    Your ID
                  </span>
                  <span className="font-mono text-sm font-black tracking-widest text-coin">
                    {profile.og_vip_id}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              {/* Plans */}
              {!hasVipRole && (
                <div className={cn("grid gap-3", !isNativeApp && "grid-cols-2")}>
                  {!isNativeApp && (
                    <button
                      type="button"
                      onClick={() => pickSelection({ type: "vip", plan: "yearly" })}
                      className="relative flex flex-col items-center rounded-xl border-2 border-coin bg-coin/10 p-3 pt-4 text-center transition hover:bg-coin/15"
                    >
                      <span className="absolute -top-2.5 rounded-full bg-coin px-2 py-0.5 text-[9px] font-black uppercase text-background">
                        Save{" "}
                        {Math.round(
                          (1 - VIP_PLAN_YEARLY.priceCents / (VIP_PLAN.priceCents * 12)) * 100,
                        )}
                        %
                      </span>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">
                        Yearly
                      </span>
                      <span className="mt-1 text-2xl font-black tabular-nums">
                        {CURRENCY_SYMBOL}
                        {(VIP_PLAN_YEARLY.priceCents / 100).toFixed(0)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ≈ {CURRENCY_SYMBOL}
                        {(VIP_PLAN_YEARLY.priceCents / 1200).toFixed(2)}/mo
                      </span>
                      <span className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-coin text-xs font-black text-background">
                        <Crown className="h-3.5 w-3.5" /> Go yearly
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => pickSelection({ type: "vip", plan: "monthly" })}
                    className="flex flex-col items-center rounded-xl border border-border bg-background/40 p-3 pt-4 text-center transition hover:border-primary/60"
                  >
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">
                      Monthly
                    </span>
                    <span className="mt-1 text-2xl font-black tabular-nums">
                      {CURRENCY_SYMBOL}
                      {(VIP_PLAN.priceCents / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">cancel anytime</span>
                    <span className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                      Go monthly
                    </span>
                  </button>
                </div>
              )}

              {/* Free vs VIP */}
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[minmax(0,1fr)_56px_64px] bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Feature</span>
                  <span className="text-center">Free</span>
                  <span className="inline-flex items-center justify-center gap-1 text-coin">
                    <Crown className="h-3 w-3" /> VIP
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {[
                    ["Chat + 29 languages", "✓", "✓"],
                    ["Music styles & moods", "6", "All"],
                    ["Request styles/languages", "🔒", "✓"],
                    ["Foul-mouth OG Bot", "🔒", "✓"],
                    ["Priority replies", "🔒", "✓"],
                    ["OG VIP ID + gold badge", "🔒", "✓"],
                    ["Daily 10-coin safety net", "🔒", "✓"],
                    ["Referral cashback", "6%", "13%"],
                  ].map(([f, a, b]) => (
                    <div
                      key={f}
                      className="grid grid-cols-[minmax(0,1fr)_56px_64px] items-center px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 font-medium">{f}</span>
                      <span className="text-center text-muted-foreground">{a}</span>
                      <span className="text-center font-black text-coin">{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <PurchaseHistory />
      </div>
    </DashboardShell>
  );
}

// ---------- Reusable section chrome ----------

function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-border bg-card shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
      {children}
    </div>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </p>
  );
}

function SectionHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-background/30 p-5 sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <SectionIcon>{icon}</SectionIcon> : null}
        <div className="min-w-0">
          {eyebrow ? <SectionEyebrow>{eyebrow}</SectionEyebrow> : null}
          <h2 className="font-display text-lg font-black tracking-tight sm:text-xl">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------- Pack card with per-field admin inline edit ----------

type EditingField = "label" | "description" | "coins" | "price" | null;

const RARITY_TIERS = [
  {
    name: "Common",
    Icon: Coins,
    ring: "ring-slate-400/40",
    glow: "",
    pill: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
  },
  {
    name: "Rare",
    Icon: Zap,
    ring: "ring-sky-400/50",
    glow: "shadow-[0_0_30px_-8px_oklch(0.7_0.18_240)]",
    pill: "bg-sky-500/15 text-sky-300 ring-sky-400/40",
  },
  {
    name: "Epic",
    Icon: Gem,
    ring: "ring-purple-400/60",
    glow: "shadow-[0_0_40px_-10px_oklch(0.7_0.22_300)]",
    pill: "bg-purple-500/15 text-purple-300 ring-purple-400/40",
  },
  {
    name: "Legendary",
    Icon: Trophy,
    ring: "ring-coin/70",
    glow: "shadow-[0_0_60px_-10px_oklch(0.8_0.18_85)]",
    pill: "bg-coin/20 text-coin ring-coin/50",
  },
  {
    name: "Mythic",
    Icon: Flame,
    ring: "ring-red-400/60",
    glow: "shadow-[0_0_60px_-10px_oklch(0.7_0.22_25)]",
    pill: "bg-red-500/15 text-red-300 ring-red-400/40",
  },
] as const;

function PackCard({
  pack,
  tierIndex,
  totalTiers,
  basePerCoin,
  onBuy,
}: {
  pack: CoinPack;
  tierIndex: number;
  totalTiers: number;
  basePerCoin: number;
  onBuy: (effective: CoinPack) => void;
}) {
  const { isAdmin } = useRole();
  const { enabled } = useAdminEditMode();
  const { get } = useSiteContent();
  const setMut = useSetSiteContent();
  const { isConfigured, loading: rcLoading, purchasePackage: rcPurchase } = useRevenueCat();
  const createCoinCheckout = useServerFn(createCoinCheckoutSession);
  const createVipCheckout = useServerFn(createVipCheckoutSession);
  const createCustomCheckout = useServerFn(createCustomCoinCheckoutSession);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const canEdit = isAdmin && enabled;

  const raw = get(packOverrideKey(pack.bundleId), "");
  const override = useMemo(() => parsePackOverride(raw), [raw]);

  const effective = applyPackOverride(pack, override);
  const showBonus = packShowsBonus(override);

  const perCoin = effective.priceCents / 100 / effective.coins;
  const savingsPct = basePerCoin > 0 ? Math.round((1 - perCoin / basePerCoin) * 100) : 0;
  const accent = pack.bestValue || pack.popular;
  // Map pack position → rarity tier (last pack always gets the top tier).
  const tierIdx =
    totalTiers <= 1
      ? 0
      : Math.min(
          RARITY_TIERS.length - 1,
          Math.round((tierIndex / (totalTiers - 1)) * (RARITY_TIERS.length - 1)),
        );
  const tier = RARITY_TIERS[tierIdx];
  const TierIcon = tier.Icon;

  const [field, setField] = useState<EditingField>(null);
  const [draft, setDraft] = useState("");

  function startEdit(f: EditingField, currentValue: string) {
    if (!canEdit || !f) return;
    setField(f);
    setDraft(currentValue);
  }

  function persist(next: PackOverride) {
    if (!canEdit) {
      toast.error("Not authorized");
      return;
    }
    setMut.mutate(
      { key: packOverrideKey(pack.bundleId), value: JSON.stringify(next) },
      {
        onSuccess: () => {
          toast.success("Saved — syncs to checkout", { id: "pack-saved" });
          setField(null);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  function commit() {
    const next: PackOverride = { ...override };
    if (field === "label") {
      const v = draft.trim();
      if (!v) return toast.error("Label required");
      next.label = v;
    } else if (field === "description") {
      next.description = draft.trim() || undefined;
    } else if (field === "coins") {
      const n = Math.trunc(Number(draft));
      if (!Number.isFinite(n) || n <= 0 || n > 1_000_000)
        return toast.error("Coins must be 1–1,000,000");
      next.coins = n;
    } else if (field === "price") {
      const pounds = Number(draft);
      if (!Number.isFinite(pounds) || pounds <= 0 || pounds > 10_000)
        return toast.error("Price must be > 0");
      next.priceCents = Math.round(pounds * 100);
    }
    persist(next);
  }

  function toggleBonus() {
    persist({ ...override, bonus: !showBonus });
  }

  function resetField(f: Exclude<EditingField, null>) {
    const next: PackOverride = { ...override };
    if (f === "label") delete next.label;
    else if (f === "description") delete next.description;
    else if (f === "coins") delete next.coins;
    else if (f === "price") delete next.priceCents;
    persist(next);
  }

  const isOverridden = (f: Exclude<EditingField, null>) => {
    if (f === "label") return override.label !== undefined;
    if (f === "description") return override.description !== undefined;
    if (f === "coins") return override.coins !== undefined;
    if (f === "price") return override.priceCents !== undefined;
    return false;
  };

  const stackCount = Math.min(4, tierIndex + 1);
  const badge = pack.popular ? "Popular" : pack.bestValue ? "Best value" : null;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-store-card p-3 shadow-card transition-colors sm:p-4",
        accent ? "border-coin/70 ring-1 ring-coin/30" : "border-border",
        tier.glow,
      )}
    >
      {badge && (
        <div className="absolute inset-x-0 top-0 bg-coin py-0.5 text-center text-[9px] font-black uppercase tracking-widest text-background">
          {badge}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-1">
        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          <TierIcon className="h-3 w-3 shrink-0" /> {tier.name}
        </span>
        {savingsPct > 0 && !canEdit && (
          <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-black text-primary">
            −{savingsPct}%
          </span>
        )}
      </div>

      {/* Coin stack visual */}
      <div className="relative mx-auto mt-2 flex h-12 items-end justify-center" aria-hidden>
        {Array.from({ length: stackCount }).map((_, k) => (
          <div
            key={k}
            className="-ml-3 grid h-10 w-10 place-items-center rounded-full border-2 border-coin/60 bg-coin/20 first:ml-0"
            style={{ transform: `translateY(${-(k % 2) * 6}px)` }}
          >
            <Coins className="h-5 w-5 text-coin" />
          </div>
        ))}
      </div>

      {/* Label */}
      <div className="mt-2 text-center">
        <EditableField
          canEdit={canEdit}
          editing={field === "label"}
          overridden={isOverridden("label")}
          onStart={() => startEdit("label", effective.label)}
          onCancel={() => setField(null)}
          onCommit={commit}
          onReset={() => resetField("label")}
          draft={draft}
          setDraft={setDraft}
          inputProps={{ maxLength: 40 }}
          view={
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {effective.label}
            </div>
          }
        />
      </div>

      {/* Coins */}
      <div className="mt-1 text-center">
        <EditableField
          canEdit={canEdit}
          editing={field === "coins"}
          overridden={isOverridden("coins")}
          onStart={() => startEdit("coins", String(effective.coins))}
          onCancel={() => setField(null)}
          onCommit={commit}
          onReset={() => resetField("coins")}
          draft={draft}
          setDraft={setDraft}
          inputProps={{ type: "number", min: 1, step: 1 }}
          view={
            <div className="flex items-baseline justify-center gap-1 whitespace-nowrap leading-none">
              {showBonus && (
                <span className="text-sm font-bold tabular-nums text-muted-foreground/70 line-through">
                  {Math.round(effective.coins / 2)}
                </span>
              )}
              <span className="text-3xl font-black tabular-nums">{effective.coins}</span>
              <span className="text-[10px] font-bold text-coin">coins</span>
            </div>
          }
        />
        <div className="mt-1 flex min-h-[18px] justify-center">
          {canEdit ? (
            <button
              type="button"
              onClick={toggleBonus}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase",
                showBonus ? "bg-coin/15 text-coin" : "bg-muted text-muted-foreground",
              )}
            >
              {showBonus ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
              {showBonus ? "2× on" : "2× off"}
            </button>
          ) : showBonus ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-coin/15 px-2 py-0.5 text-[9px] font-black uppercase text-coin">
              <Sparkles className="h-2.5 w-2.5" /> 2× bonus
            </span>
          ) : null}
        </div>
      </div>

      {canEdit && (
        <div className="mt-2">
          <EditableField
            canEdit={canEdit}
            editing={field === "description"}
            overridden={isOverridden("description")}
            onStart={() => startEdit("description", effective.description)}
            onCancel={() => setField(null)}
            onCommit={commit}
            onReset={() => resetField("description")}
            draft={draft}
            setDraft={setDraft}
            multiline
            inputProps={{ maxLength: 240 }}
            view={<p className="text-[11px] text-muted-foreground">{effective.description}</p>}
          />
        </div>
      )}

      <div className="flex-1" />

      {/* Price */}
      <div className="mt-3 text-center">
        <EditableField
          canEdit={canEdit}
          editing={field === "price"}
          overridden={isOverridden("price")}
          onStart={() => startEdit("price", (effective.priceCents / 100).toFixed(2))}
          onCancel={() => setField(null)}
          onCommit={commit}
          onReset={() => resetField("price")}
          draft={draft}
          setDraft={setDraft}
          inputProps={{ type: "number", min: 0.01, step: 0.01, inputMode: "decimal" }}
          prefix={CURRENCY_SYMBOL}
          view={
            <span className="text-xl font-black tracking-tight">
              {CURRENCY_SYMBOL}
              {(effective.priceCents / 100).toFixed(2)}
            </span>
          }
        />
        <p className="text-[10px] text-muted-foreground">{(perCoin * 100).toFixed(1)}p per coin</p>
      </div>

      <button
        type="button"
        onClick={() => onBuy(effective)}
        disabled={field !== null}
        aria-label={`Buy ${effective.coins} OG Coins for ${CURRENCY_SYMBOL}${(effective.priceCents / 100).toFixed(2)}`}
        className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-2 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
      >
        Buy
      </button>
    </div>
  );
}

// Inline editable field — pencil on hover, ✓/✗ to commit/cancel, ↺ to reset.
function EditableField({
  canEdit,
  editing,
  overridden,
  onStart,
  onCancel,
  onCommit,
  onReset,
  draft,
  setDraft,
  view,
  multiline = false,
  prefix,
  inputProps,
}: {
  canEdit: boolean;
  editing: boolean;
  overridden: boolean;
  onStart: () => void;
  onCancel: () => void;
  onCommit: () => void;
  onReset: () => void;
  draft: string;
  setDraft: (v: string) => void;
  view: ReactNode;
  multiline?: boolean;
  prefix?: string;
  inputProps?: Record<string, unknown>;
}) {
  if (editing) {
    return (
      <div className="rounded-md border border-primary/50 bg-primary/5 p-2">
        <div className="flex items-start gap-1.5">
          {prefix ? <span className="pt-1.5 text-sm font-bold">{prefix}</span> : null}
          {multiline ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...(inputProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              className="h-8 flex-1 text-sm"
              {...(inputProps as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onCancel}
            title="Cancel"
            aria-label="Cancel edit"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="h-7 w-7 bg-emerald-500 text-white hover:bg-emerald-600"
            onClick={onCommit}
            title="Save"
            aria-label="Save changes"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (!canEdit) return <>{view}</>;

  return (
    <div className="group/edit relative -mx-1 rounded px-1 outline-dashed outline-1 outline-transparent transition hover:outline-primary/40 hover:bg-primary/5">
      {view}
      <div className="pointer-events-none absolute right-0 top-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/edit:opacity-100">
        {overridden && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className="pointer-events-auto grid h-5 w-5 place-items-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-foreground"
            title="Reset to default"
            aria-label="Reset"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="pointer-events-auto grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm"
          title="Edit"
          aria-label="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {overridden && (
        <span className="ml-1 inline-block align-middle text-[9px] font-bold uppercase tracking-wider text-primary">
          ●
        </span>
      )}
    </div>
  );
}

function TrustItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-right">
        <span className="text-sm font-bold tabular-nums">{value}</span>
        {hint && (
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

function NextStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-coin/50 bg-coin/15 text-[11px] font-black text-coin tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function CustomPackCard({ onBuy }: { onBuy: (units: number) => void }) {
  const [units, setUnits] = useState<number>(CUSTOM_COIN_UNIT.minUnits);
  const [bumpError, setBumpError] = useState<string | null>(null);
  const coins = units * CUSTOM_COIN_UNIT.coins;
  const totalCents = units * CUSTOM_COIN_UNIT.priceCents;
  const minCoins = CUSTOM_COIN_UNIT.minUnits * CUSTOM_COIN_UNIT.coins;
  const maxCoins = CUSTOM_COIN_UNIT.maxUnits * CUSTOM_COIN_UNIT.coins;
  const atMin = units <= CUSTOM_COIN_UNIT.minUnits;
  const atMax = units >= CUSTOM_COIN_UNIT.maxUnits;
  // Per-coin price using consistent GBP rounding (3 dp for fractional pennies).
  const perCoin = CUSTOM_COIN_UNIT.priceCents / 100 / CUSTOM_COIN_UNIT.coins;

  const bump = (delta: number) => {
    const next = Math.min(
      CUSTOM_COIN_UNIT.maxUnits,
      Math.max(CUSTOM_COIN_UNIT.minUnits, units + delta),
    );
    if (next === units) {
      setBumpError(
        delta < 0
          ? `Minimum top-up is ${minCoins} coins.`
          : `Maximum custom top-up is ${maxCoins} coins.`,
      );
      return;
    }
    setBumpError(null);
    setUnits(next);
  };

  const quickPicks = [5, 10, 25, 50].filter((n) => n <= CUSTOM_COIN_UNIT.maxUnits);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-store-card p-4 shadow-card sm:p-5">
      {/* Header */}
      <div className="relative flex items-start gap-3 sm:gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Coins className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Choose any amount
          </div>
          <h3 className="font-display text-lg font-black sm:text-xl">Build your stack</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
              {CURRENCY_SYMBOL}
              {(CUSTOM_COIN_UNIT.priceCents / 100).toFixed(2)} → {CUSTOM_COIN_UNIT.coins} OG
            </span>
            <span className="text-xs text-muted-foreground">
              ≈ {CURRENCY_SYMBOL}
              {perCoin.toFixed(3)} / coin
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground sm:text-sm">
            Tap + or − to size your crate. Min {minCoins} · max {maxCoins} coins.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="relative mt-5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-14 w-12 shrink-0 rounded-lg p-0 sm:h-16 sm:w-14"
          onClick={() => bump(-1)}
          disabled={atMin}
          aria-label={`Remove ${CUSTOM_COIN_UNIT.coins} coins`}
          title={
            atMin
              ? `Already at minimum (${minCoins} coins)`
              : `Remove ${CUSTOM_COIN_UNIT.coins} coins`
          }
        >
          <Minus className="h-7 w-7" />
        </Button>

        <div className="relative flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-background/60 px-3 py-3">
          <div className="relative text-xs font-semibold uppercase text-muted-foreground">
            You get
          </div>
          <div className="relative mt-1 flex items-baseline justify-center gap-2 leading-none">
            <Coins className="h-6 w-6 shrink-0 text-coin drop-shadow-[0_0_8px_rgba(251,191,36,0.7)]" />
            <span
              key={coins}
              className="font-mono text-[clamp(2rem,10vw,3rem)] font-bold tabular-nums"
              aria-live="polite"
            >
              {coins}
            </span>
            <span className="text-xs font-bold text-primary">OG</span>
          </div>
          <div className="relative mt-1 text-xs text-muted-foreground tabular-nums">
            {units} × {CURRENCY_SYMBOL}
            {(CUSTOM_COIN_UNIT.priceCents / 100).toFixed(2)}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-14 w-12 shrink-0 rounded-lg p-0 sm:h-16 sm:w-14"
          onClick={() => bump(1)}
          disabled={atMax}
          aria-label={`Add ${CUSTOM_COIN_UNIT.coins} coins`}
          title={
            atMax ? `Already at maximum (${maxCoins} coins)` : `Add ${CUSTOM_COIN_UNIT.coins} coins`
          }
        >
          <Plus className="h-7 w-7" />
        </Button>
      </div>

      {/* Quick picks */}
      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {quickPicks.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setBumpError(null);
              setUnits(q);
            }}
            className={cn(
              "min-h-9 rounded-md border px-2.5 py-1 text-xs font-bold transition",
              units === q
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background/50 text-muted-foreground hover:border-primary hover:text-foreground",
            )}
          >
            +{q * CUSTOM_COIN_UNIT.coins} · {CURRENCY_SYMBOL}
            {((q * CUSTOM_COIN_UNIT.priceCents) / 100).toFixed(2)}
          </button>
        ))}
      </div>

      {bumpError ? (
        <p role="alert" className="relative mt-2 text-[11px] font-bold text-red-300">
          {bumpError}
        </p>
      ) : atMin || atMax ? (
        <p className="relative mt-2 text-[11px] text-white/60">
          {atMin
            ? `You're at the minimum (${minCoins} coins).`
            : `You're at the maximum (${maxCoins} coins).`}
        </p>
      ) : null}

      {/* Total + CTA */}
      <div className="relative mt-4 flex flex-col gap-3 border-t border-border pt-4 min-[400px]:grid min-[400px]:grid-cols-[minmax(0,1fr)_auto] min-[400px]:items-end">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Total</div>
          <div
            key={totalCents}
            className="font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl"
          >
            {CURRENCY_SYMBOL}
            {(totalCents / 100).toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">one-time · {coins} OG coins</div>
        </div>
        <Button
          size="lg"
          onClick={() => onBuy(units)}
          className="h-11 w-full rounded-md px-4 font-bold min-[400px]:w-auto"
        >
          <Flame className="mr-2 h-4 w-4" /> Buy · {CURRENCY_SYMBOL}
          {(totalCents / 100).toFixed(2)}
        </Button>
      </div>
    </div>
  );
}
