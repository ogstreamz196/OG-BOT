// OG Signals: the live board (see components/signals/SignalsBoard.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { SignalsBoard } from "@/components/signals/SignalsBoard";

export const Route = createFileRoute("/_authenticated/signals")({
  head: () => ({
    meta: [
      { title: "OG Signals | OG BOT" },
      {
        name: "description",
        content: "Live trade signals for gold, crypto, forex and indices, updated in real time.",
      },
      { property: "og:title", content: "OG Signals | OG BOT" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: SignalsBoard,
});
