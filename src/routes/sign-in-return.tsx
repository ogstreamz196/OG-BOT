import { createFileRoute } from "@tanstack/react-router";
import { AppReturn } from "@/components/auth/AppReturn";

export const Route = createFileRoute("/sign-in-return")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Return to OG B0T | AI Songs & Diss Tracks" },
      { name: "description", content: "Finish signing in and open the OG B0T app." },
      { property: "og:title", content: "Return to OG B0T | AI Songs & Diss Tracks" },
      { property: "og:description", content: "Finish signing in and open the OG B0T app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppReturn,
});
