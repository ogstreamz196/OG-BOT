import { createFileRoute, redirect } from "@tanstack/react-router";
import { CoinStore } from "@/components/store/CoinStore";

export const Route = createFileRoute("/_authenticated/buy-coins/")({
  validateSearch: (s: Record<string, unknown>): { edit?: 1 } =>
    s.edit === "1" || s.edit === 1 || s.edit === true ? { edit: 1 } : {},
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/store", search: { edit: search.edit } });
  },
  head: () => ({
    meta: [
      { title: "OG Coins & VIP — OG BOT Store | AI Songs & Diss Tracks" },
      {
        name: "description",
        content: "Buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:title", content: "OG Coins & VIP — OG BOT Store | AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content: "Buy OG Coins, unlock VIP perks, and review purchases in the OG BOT Store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Always redirects to /store, which renders CoinStore.
  component: () => null,
});
