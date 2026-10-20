import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getCarromLink } from "@/lib/carrom-link.functions";

export const Route = createFileRoute("/_authenticated/play-carrom")({
  head: () => ({
    meta: [{ title: "Play OG CARROM — OG Streamz" }, { name: "robots", content: "noindex" }],
  }),
  component: PlayCarrom,
});

/** Signs the member into OG CARROM (carrom.ogbot.co.uk) with one tap. */
function PlayCarrom() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCarromLink()
      .then(({ url }) => {
        if (!cancelled) window.location.replace(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open OG CARROM.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm place-content-center gap-3 p-6 text-center">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">Couldn't open OG CARROM</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
          <a href="https://carrom.ogbot.co.uk" className="underline">
            Play as a guest instead
          </a>
        </>
      ) : (
        <p role="status" className="text-muted-foreground">
          Opening OG CARROM…
        </p>
      )}
    </main>
  );
}
