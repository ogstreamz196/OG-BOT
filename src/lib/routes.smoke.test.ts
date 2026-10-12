import { describe, it, expect } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

/**
 * Smoke test: every key link in the app must resolve to a real route in the
 * generated route tree. If a Link `to` is renamed or a route file deleted,
 * this fails before the user sees an empty screen.
 */
const KEY_LINKS = [
  "/",
  "/welcome",
  "/auth",
  "/library",
  "/library/$songId",
  "/messenger",
  "/buy-coins",
  "/buy-coins/return",
  "/settings",

  "/developer",
  "/referrals",
  "/admin",
  "/admin/users",
  "/admin/user-settings",
  "/admin/og-persona",
  "/admin/music",
  "/admin/coins",
  "/admin/bot",
  "/admin/system",
  "/admin/audit",
  "/admin/store",
];

describe("route smoke test", () => {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
  });
  const ids = new Set(Object.keys(router.routesById));

  it.each(KEY_LINKS)("route %s is registered", (path) => {
    // Routes are keyed by file id; child index routes end with "/".
    const candidates = [path, path === "/" ? "/" : `${path}/`];
    const found = candidates.some((p) => ids.has(p) || ids.has(`/_authenticated${p}`));
    expect(found, `missing route ${path}. Known: ${[...ids].join(", ")}`).toBe(true);
  });
});
