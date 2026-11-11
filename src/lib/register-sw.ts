/**
 * The only place the app-shell service worker is registered. Caches built
 * assets on the device so the app opens fast; pages stay network-first.
 */
const SW_PATH = "/sw.js";
const PRELOAD_RELOAD_KEY = "og:preload-reload";

/** A message or form someone has started typing. */
function hasUnsavedText(): boolean {
  return (
    Array.from(
      document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
        'textarea, input[type="text"], input:not([type])',
      ),
    ).some((el) => !el.readOnly && !el.disabled && el.value.trim().length > 0) ||
    Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]')).some(
      (el) => (el.textContent ?? "").trim().length > 0,
    )
  );
}

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
  // A new version took over: reload to it, but never under someone's
  // fingers. Wait until the page is in the background and nothing typed
  // would be lost; a lazy chunk that vanished with the old deploy reloads
  // straight away instead (vite:preloadError below).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  const reloadWhenSafe = () => {
    if (document.visibilityState === "hidden" && !hasUnsavedText()) reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    reloadWhenSafe();
    document.addEventListener("visibilitychange", reloadWhenSafe);
  });
  window.addEventListener("vite:preloadError", (e) => {
    // Once per 10s at most, so a real outage can't loop.
    try {
      const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0);
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
    } catch {
      /* storage blocked: still reload once */
    }
    e.preventDefault();
    reload();
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
