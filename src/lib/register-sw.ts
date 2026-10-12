/**
 * The only place the app-shell service worker is registered. Caches built
 * assets on the device so the app opens fast; pages stay network-first.
 */
const SW_PATH = "/sw.js";

async function unregisterAppSw() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs
      .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith(SW_PATH))
      .map((r) => r.unregister()),
  );
}

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  const blocked = ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"];
  if (blocked.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

export function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (refused()) {
    void unregisterAppSw();
    return;
  }
  // Reload once when a new version takes over so users never run old code.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  // Register immediately and check the server for a newer version right away,
  // whenever the app comes back into view, on reconnect, and every 5 minutes.
  navigator.serviceWorker
    .register(SW_PATH, { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      const check = () => void reg.update().catch(() => {});
      check();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.addEventListener("focus", check);
      window.addEventListener("online", check);
      setInterval(check, 5 * 60_000);
    })
    .catch(() => {});
}
