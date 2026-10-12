import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { arePaymentsEnabled } from "@/lib/stripe";
import { StoreItemCard } from "@/components/store/StoreItemCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getSportsGuideAccessStatus,
  listStoreCatalog,
  purchaseSportsGuideAccess,
  createStoreItemCheckoutSession,
} from "@/lib/store.functions";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";
import { getStripeEnvironment } from "@/lib/stripe";
import { getVipPassStatus, purchaseVipPass } from "@/lib/vip-pass.functions";

const ALL_ITEMS = "all";

export function StoreItemsSection() {
  const queryClient = useQueryClient();
  const getAccessStatus = useServerFn(getSportsGuideAccessStatus);
  const purchaseAccess = useServerFn(purchaseSportsGuideAccess);
  const createCheckout = useServerFn(createStoreItemCheckoutSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["store-catalog"],
    queryFn: () => listStoreCatalog(),
  });
  const access = useQuery({
    queryKey: ["sports-guide-access"],
    queryFn: () => getAccessStatus(),
  });
  const getVipStatus = useServerFn(getVipPassStatus);
  const buyVipPass = useServerFn(purchaseVipPass);
  const vipStatus = useQuery({ queryKey: ["vip-pass-status"], queryFn: () => getVipStatus() });
  const categories = catalog.data?.categories ?? [];
  const allItems = useMemo(() => categories.flatMap((category) => category.items), [categories]);
  useEffect(() => {
    if (allItems.length === 0 || typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("item-")) return;
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-4", "ring-coin");
      setTimeout(() => el.classList.remove("ring-4", "ring-coin"), 2500);
    }, 300);
    return () => clearTimeout(t);
  }, [allItems.length]);
  const returnUrl = useMemo(
    () =>
      `${typeof window === "undefined" ? "" : window.location.origin}/buy-coins/return?session_id={CHECKOUT_SESSION_ID}`,
    [],
  );

  const sportsGuide = useMutation({
    mutationFn: () => purchaseAccess(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sports-guide-access"] }),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["coin-transactions"] }),
      ]);
      toast.success("Sports Guide unlocked — open it from your dashboard");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const vipPass = useMutation({
    mutationFn: () => buyVipPass(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vip-pass-status"] }),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["coin-transactions"] }),
      ]);
      toast.success("Vault pass unlocked — your login details are on the card");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const buy = (itemId: string) => {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (item?.slug === "og-sports-guide-access") {
      sportsGuide.mutate();
      return;
    }
    if (item?.slug === "og-vip-pass") {
      vipPass.mutate();
      return;
    }
    startCheckout(itemId);
  };

  const startCheckout = (itemId: string) => {
    if (!arePaymentsEnabled() || Capacitor.isNativePlatform()) {
      toast.info("This item isn't available in the app yet.");
      return;
    }
    setStartingId(itemId);
    createCheckout({ data: { itemId, returnUrl, environment: getStripeEnvironment() } })
      .then((r) => {
        if ("error" in r) throw new Error(r.error);
        setClientSecret(r.clientSecret);
      })
      .catch((e: Error) => toast.error(e.message || "Checkout could not start."))
      .finally(() => setStartingId(null));
  };

  const renderItem = (item: (typeof allItems)[number]) => (
    <StoreItemCard
      key={item.id}
      item={item}
      onBuy={buy}
      onBuyCash={item.slug === "og-vip-pass" ? startCheckout : undefined}
      buying={
        (item.slug === "og-sports-guide-access" && sportsGuide.isPending) ||
        (item.slug === "og-vip-pass" && vipPass.isPending) ||
        startingId === item.id
      }
      sportsGuideState={item.slug === "og-sports-guide-access" ? access.data?.status : undefined}
      sportsGuideInviteUrl={
        item.slug === "og-sports-guide-access" ? (access.data?.inviteUrl ?? undefined) : undefined
      }
      vipPass={item.slug === "og-vip-pass" ? vipStatus.data : undefined}
    />
  );

  return (
    <section aria-labelledby="store-items-heading" className="scroll-mt-24">
      <div className="mb-3 flex items-center gap-2">
        <PackageOpen className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Member access & extras
          </p>
          <h2 id="store-items-heading" className="font-display text-xl font-black">
            Store items
          </h2>
        </div>
      </div>

      {catalog.isLoading ? (
        <div className="grid place-items-center rounded-2xl border border-border py-12">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : catalog.error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-center text-sm text-destructive">
          Couldn’t load Store items. Try refreshing.
        </div>
      ) : allItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Store items are available yet.
        </div>
      ) : (
        <Tabs defaultValue={ALL_ITEMS}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 min-[520px]:flex min-[520px]:flex-wrap min-[520px]:justify-start">
            <TabsTrigger
              value={ALL_ITEMS}
              className="min-h-11 w-full whitespace-normal border border-border bg-store-card-muted px-3 py-2 text-center leading-tight data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground min-[520px]:w-auto"
            >
              All
            </TabsTrigger>
            {categories.map((category) => (
              <TabsTrigger
                key={category.id}
                value={category.slug}
                className="min-h-11 w-full whitespace-normal border border-border bg-store-card-muted px-3 py-2 text-center leading-tight data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground min-[520px]:w-auto"
              >
                {category.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={ALL_ITEMS} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allItems.map(renderItem)}
          </TabsContent>
          {categories.map((category) => (
            <TabsContent key={category.id} value={category.slug} className="mt-4">
              {category.description ? (
                <p className="mb-3 text-sm text-muted-foreground">{category.description}</p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.items.map(renderItem)}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      <StripeCheckoutDialog clientSecret={clientSecret} onClose={() => setClientSecret(null)} />
    </section>
  );
}
