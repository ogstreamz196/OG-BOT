// Fallback app service worker, served from public/ on every host.
//
// The full worker is generated at build time by vite-plugin-pwa into
// .output/public/sw.js (vite.config.ts), but the live site (Cloudflare) serves
// a different build folder, so /sw.js was a 404 on every page: no worker meant
// "your track is ready" notifications failed on Android (Chrome only shows
// them through a service worker) and their taps had nothing to open them.
// Where the generated worker is deployed it overwrites this file.
//
// Deliberately minimal: it takes control and handles notification taps
// (sw-notify.js). No fetch handler and no caching, so nothing can go stale.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
importScripts("/sw-notify.js");
