import { useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCarromGuestLink, getCarromLink } from "@/lib/carrom-link.functions";
import { CARROM_URL, watchCarromCard } from "@/components/welcome/og-carrom";

/** Passes last 5 minutes; fetch a fresh one if the cached one is older than this. */
const FRESH_MS = 3 * 60_000;

/**
 * Members open OG Carrom with a short-lived pass, so carrom sets up their
 * account with their OG BOT name. The pass is fetched while the card is on
 * screen, so the tap doesn't wait for it.
 */
export function useCarromLink(opts: { guest?: boolean } = {}) {
  // Guests (the landing page) get a guest pass instead: picking a carrom
  // username then makes them an OG B0T account with the same name.
  const linkFn = useServerFn(opts.guest ? getCarromGuestLink : getCarromLink);
  const cached = useRef<{ url: string; at: number } | null>(null);

  const fetchLink = useCallback(async () => {
    const { url } = await linkFn();
    cached.current = { url, at: Date.now() };
    return url;
  }, [linkFn]);

  const onShown = useCallback(
    (el: Element) => {
      void fetchLink().catch(() => {});
      return watchCarromCard(el);
    },
    [fetchLink],
  );

  const open = useCallback(async () => {
    const hit = cached.current;
    let url = hit && Date.now() - hit.at < FRESH_MS ? hit.url : null;
    if (!url) url = await fetchLink().catch(() => CARROM_URL);
    window.location.assign(url);
  }, [fetchLink]);

  return { onShown, open };
}
