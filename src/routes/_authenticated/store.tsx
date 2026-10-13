import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { CoinStore } from "./buy-coins.index";
import { Paywall } from "@/components/revenuecat/Paywall";

export const Route = createFileRoute("/_authenticated/store")({
  validateSearch: (search: Record<string, unknown>): { edit?: 1 } => ({
    edit: search.edit === "1" || search.edit === 1 || search.edit === true ? 1 : undefined,
  }),
  component: StorePage,
  head: () => ({
    meta: [
      { title: "OG Store — Coins, VIP & Loot | AI Songs & Diss Tracks" },
      {
        name: "description",
        content:
          "Shop limited items, buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:title", content: "OG Store — Coins, VIP & Loot | AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content:
          "Shop limited items, buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function StorePage() {
  const search = Route.useSearch();
  // The phone app must offer subscriptions through Google Play billing, so the
  // RevenueCat paywall is shown at the top of the Store there. The website keeps
  // its own card checkout untouched.
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
  }, []);

  return (
    <>
      {native && (
        <div className="px-4 pt-4 sm:px-6">
          <Paywall />
        </div>
      )}
      <CoinStore editMode={search.edit} />
    </>
  );
}
