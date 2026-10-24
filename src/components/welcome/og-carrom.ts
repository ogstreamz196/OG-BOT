// OG Carrom lives on its own site. The home pages link to it and warm it up
// in the background so tapping the card opens the game almost instantly.

export const CARROM_URL = "https://carrom.ogbot.co.uk/";
const CARROM_ORIGIN = "https://carrom.ogbot.co.uk";
const WARM_KEY = "og:carrom-warm";

type NetInfo = { saveData?: boolean; effectiveType?: string };

/** Skip the background warm-up on data saver or a very slow connection. */
function connectionAllowsWarmup(): boolean {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  if (!c) return true;
  return !c.saveData && !/(^|-)2g$/.test(c.effectiveType ?? "");
}

let preconnected = false;
/** Opens the connection to the carrom site early (DNS + TLS), once per page. */
function preconnect() {
  if (preconnected) return;
  preconnected = true;
  for (const rel of ["preconnect", "dns-prefetch"]) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = CARROM_ORIGIN;
    document.head.appendChild(link);
  }
  // Fetch the page itself ahead of the tap where the browser supports it.
  if (HTMLScriptElement.supports?.("speculationrules")) {
    const rules = document.createElement("script");
    rules.type = "speculationrules";
    rules.textContent = JSON.stringify({ prefetch: [{ urls: [CARROM_URL] }] });
    document.head.appendChild(rules);
  }
}

/**
 * Once per browser session, quietly loads carrom's /warm.html (it only
 * installs carrom's offline cache, which downloads the game's shell), then
 * removes it. No game code runs and nothing about the visitor is sent.
 */
function warmCache() {
  try {
    if (sessionStorage.getItem(WARM_KEY)) return;
    sessionStorage.setItem(WARM_KEY, "1");
  } catch {
    /* storage blocked: still fine to warm once per page */
  }
  const frame = document.createElement("iframe");
  frame.src = `${CARROM_ORIGIN}/warm.html`;
  frame.title = "";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 20_000);
}

/**
 * Starts the warm-up when the OG Carrom card scrolls into view: connect
 * straight away, then fill the cache when the browser is idle.
 */
export function watchCarromCard(el: Element | null): () => void {
  if (!el || typeof IntersectionObserver === "undefined") return () => {};
  let cancelIdle = () => {};
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      preconnect();
      if (!connectionAllowsWarmup()) return;
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(warmCache, { timeout: 4000 });
        cancelIdle = () => w.cancelIdleCallback?.(id);
      } else {
        const t = window.setTimeout(warmCache, 1500);
        cancelIdle = () => clearTimeout(t);
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(el);
  return () => {
    io.disconnect();
    cancelIdle();
  };
}
