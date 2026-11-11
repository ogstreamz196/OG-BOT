// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { loadEnv } from "vite";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";
import { legacyCssPlugin } from "./vite-legacy-css";

const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Hide internal logic in shipped bundles so the foul-mouth lexicon, persona
    // prompts, and other server-side strings cannot be traced back to source.
    build: { sourcemap: false, minify: "esbuild" },
    css: { devSourcemap: false },
    resolve: {
      alias: [
        {
          find: /^entities\/lib\/decode\.js$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/decode.js"),
        },
        {
          find: /^entities\/lib\/encode\.js$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/encode.js"),
        },
      ],
    },
    plugins: [
      mcpPlugin(),
      legacyCssPlugin(),
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        manifest: false,
        filename: "sw.js",
        // The published site is .output/public (nitro). Writing the worker to
        // Vite's default dist/ meant /sw.js was never deployed.
        outDir: ".output/public",
        devOptions: { enabled: false },
        workbox: {
          // Nothing is downloaded up front: the build has ~500 files (~20MB,
          // mostly code-highlighting languages that load on demand). Built
          // assets are cached as they're used (og-assets below) instead.
          globPatterns: ["favicon.png"],
          navigateFallback: null,
          // Opens the track page when a "track ready" notification is tapped.
          importScripts: ["/sw-notify.js"],
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                !url.pathname.startsWith("/~oauth") &&
                !url.pathname.startsWith("/auth") &&
                !url.pathname.startsWith("/api/") &&
                // Shared tracks carry a short-lived audio link: always load them fresh.
                !url.pathname.startsWith("/track/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "og-pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 3600 },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: {
                cacheName: "og-assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === "https://fonts.googleapis.com" ||
                url.origin === "https://fonts.gstatic.com",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "og-fonts",
                expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 3600 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url, request }) =>
                request.destination === "image" &&
                url.pathname.includes("/storage/v1/object/public/"),
              handler: "CacheFirst",
              options: {
                cacheName: "og-images",
                expiration: { maxEntries: 150, maxAgeSeconds: 14 * 24 * 3600 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  },
});
