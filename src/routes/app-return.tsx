import { createFileRoute } from "@tanstack/react-router";
import { AppReturn } from "@/components/auth/AppReturn";

export const Route = createFileRoute("/app-return")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in | OG BOT — AI Songs & Diss Tracks" },
      { name: "description", content: "Finishing sign-in and returning you to OG BOT." },
      { property: "og:title", content: "Signing you in | OG BOT — AI Songs & Diss Tracks" },
      { property: "og:description", content: "Finishing sign-in and returning you to OG BOT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppReturn,
});
