#!/usr/bin/env node
/**
 * Blue-text guard with full authenticated coverage.
 *
 * Walks every visible text node on a curated list of public + signed-in
 * routes (including admin pages and dynamic song/user IDs) and fails when
 * the computed `color` falls in the blue family (hue 180°–305° in HSL with
 * meaningful saturation).
 *
 * Authentication:
 *   - If LOVABLE_BROWSER_SUPABASE_STORAGE_KEY + LOVABLE_BROWSER_SUPABASE_SESSION_JSON
 *     are set, the script restores that session into localStorage before
 *     visiting `_authenticated/*` routes.
 *   - If the env vars are missing AND authenticated routes are requested,
 *     the script exits non-zero before scanning — silent skips hide blue
 *     text on protected pages.
 *
 * Dynamic IDs:
 *   - SONG_ID and USER_ID env vars override defaults.
 *   - When unset, the script reads the signed-in user's first song from
 *     Supabase via the publishable key + bearer token, and uses the user's
 *     own id for admin.users.$userId.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/no-blue-text-check.mjs
 *   ROUTES="/ /messenger" VIEWPORTS=mobile node scripts/no-blue-text-check.mjs
 *   STRICT_AUTH=0 node scripts/no-blue-text-check.mjs   # allow auth skip
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const STRICT_AUTH = process.env.STRICT_AUTH !== "0";

const PUBLIC_ROUTES = ["/", "/welcome", "/trust", "/auth"];
const AUTH_ROUTES = [
  "/messenger",
  "/library",
  "/buy-coins",
  "/buy-coins/return",
  "/referrals",
  "/settings",
  "/purchase-history",
  "/community",
  "/developer",
];
const ADMIN_ROUTES = [
  "/admin",
  "/admin/users",
  "/admin/users-pro",
  "/admin/webhooks",
  "/admin/api-keys",
  "/admin/coin-audit",
  "/admin/onboarding",
  "/admin/og-persona",
  "/admin/route-map",
  "/admin/debug-context",
  "/admin/referrals-audit",
  "/admin/user-settings",
];
const DYNAMIC_ROUTE_BUILDERS = [
  (ids) => (ids.songId ? `/library/${ids.songId}` : null),
  (ids) => (ids.userId ? `/admin/users/${ids.userId}` : null),
];

const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(/\s+/)
      .filter(Boolean)
      .map((r) => ({ path: r, auth: r.startsWith("/admin") || !PUBLIC_ROUTES.includes(r) }))
  : [
      ...PUBLIC_ROUTES.map((p) => ({ path: p, auth: false })),
      ...AUTH_ROUTES.map((p) => ({ path: p, auth: true })),
      ...ADMIN_ROUTES.map((p) => ({ path: p, auth: true })),
    ];

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};
const PICKED = (process.env.VIEWPORTS ?? "mobile,desktop")
  .split(",")
  .map((v) => v.trim())
  .filter((v) => VIEWPORTS[v]);

const SAT_MIN = Number(process.env.SAT_MIN ?? 0.18);
const LIGHT_MAX = Number(process.env.LIGHT_MAX ?? 0.92);
const OUT = process.env.OUT_DIR ?? "/mnt/documents/no-blue-text";

const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const accessToken = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;

const hasSession = Boolean(storageKey && sessionJson);
const needsAuth = ROUTES.some((r) => r.auth);

if (needsAuth && !hasSession) {
  const msg =
    "Authenticated routes requested but LOVABLE_BROWSER_SUPABASE_* session vars are missing.\n" +
    "Run via the sandbox after signing into the preview, or set STRICT_AUTH=0 to skip silently.";
  if (STRICT_AUTH) {
    console.error("FATAL " + msg);
    process.exit(2);
  }
  console.warn("WARN  " + msg);
}

await mkdir(OUT, { recursive: true });

// --- Resolve dynamic ids (songId, userId) ----------------------------------
async function resolveIds() {
  const ids = {
    songId: process.env.SONG_ID || null,
    userId: process.env.USER_ID || null,
  };
  if (!hasSession || !SUPABASE_URL || !SUPABASE_KEY) return ids;
  try {
    const sess = JSON.parse(sessionJson);
    const token = accessToken || sess?.access_token;
    const uid = sess?.user?.id;
    if (uid && !ids.userId) ids.userId = uid;
    if (!ids.songId && token) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=id&limit=1&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]?.id) ids.songId = rows[0].id;
      }
    }
  } catch (e) {
    console.warn(`WARN  could not resolve dynamic ids: ${e.message}`);
  }
  return ids;
}

const ids = await resolveIds();
const dynamic = DYNAMIC_ROUTE_BUILDERS.map((fn) => fn(ids)).filter(Boolean);
for (const path of dynamic) ROUTES.push({ path, auth: true });

console.log(`scanning ${ROUTES.length} routes × ${PICKED.length} viewports`);
if (hasSession) console.log("auth: session restored");
if (ids.songId) console.log(`dynamic songId: ${ids.songId}`);
if (ids.userId) console.log(`dynamic userId: ${ids.userId}`);

// --- Scan loop -------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const violations = [];

try {
  for (const vpName of PICKED) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName] });
    const page = await ctx.newPage();

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    if (hasSession) {
      await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);
    }

    for (const route of ROUTES) {
      if (route.auth && !hasSession) {
        console.log(`- [${vpName}] ${route.path}  (skipped — no session)`);
        continue;
      }
      try {
        await page.goto(`${BASE}${route.path}`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
      } catch (e) {
        console.warn(`? [${vpName}] ${route.path}  (load failed: ${e.message})`);
        continue;
      }
      await page.waitForTimeout(1000);

      // bounced to /auth → route is gated and we lost session; mark and continue
      if (route.auth && /\/auth(\?|$)/.test(new URL(page.url()).pathname + page.url())) {
        console.warn(`? [${vpName}] ${route.path}  (redirected to /auth)`);
        continue;
      }

      const offenders = await page.evaluate(
        ({ satMin, lightMax }) => {
          const toHsl = (r, g, b) => {
            r /= 255;
            g /= 255;
            b /= 255;
            const max = Math.max(r, g, b),
              min = Math.min(r, g, b);
            const l = (max + min) / 2;
            let h = 0,
              s = 0;
            if (max !== min) {
              const d = max - min;
              s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
              switch (max) {
                case r:
                  h = (g - b) / d + (g < b ? 6 : 0);
                  break;
                case g:
                  h = (b - r) / d + 2;
                  break;
                case b:
                  h = (r - g) / d + 4;
                  break;
              }
              h *= 60;
            }
            return { h, s, l };
          };
          const parseColor = (str) => {
            const m = str.match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            const [r, g, b, a = 1] = m[1].split(",").map((s) => parseFloat(s.trim()));
            if (a < 0.2) return null;
            return { r, g, b };
          };
          const sel = (el) => {
            const id = el.id ? `#${el.id}` : "";
            const cls =
              el.className && typeof el.className === "string"
                ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".")
                : "";
            return `${el.tagName.toLowerCase()}${id}${cls}`;
          };
          const hits = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
          let node = walker.currentNode;
          while ((node = walker.nextNode())) {
            const el = node;
            const tag = el.tagName;
            if (tag === "SVG" || tag === "PATH" || tag === "SCRIPT" || tag === "STYLE") continue;
            const hasText = Array.from(el.childNodes).some(
              (c) => c.nodeType === 3 && c.nodeValue && c.nodeValue.trim().length > 0,
            );
            if (!hasText) continue;
            const cs = getComputedStyle(el);
            const rgb = parseColor(cs.color);
            if (!rgb) continue;
            const { h, s, l } = toHsl(rgb.r, rgb.g, rgb.b);
            if (s < satMin) continue;
            if (l > lightMax) continue;
            if (h >= 180 && h <= 305) {
              hits.push({
                selector: sel(el),
                color: cs.color,
                hsl: `h=${h.toFixed(0)} s=${s.toFixed(2)} l=${l.toFixed(2)}`,
                text: (el.textContent || "").trim().slice(0, 60),
              });
              if (hits.length >= 25) break;
            }
          }
          return hits;
        },
        { satMin: SAT_MIN, lightMax: LIGHT_MAX },
      );

      if (offenders.length) {
        const shot = `${OUT}/${vpName}__${route.path.replace(/\W+/g, "_") || "home"}.png`;
        await page.screenshot({ path: shot });
        for (const o of offenders) {
          violations.push({ viewport: vpName, route: route.path, screenshot: shot, ...o });
        }
        console.error(`✗ [${vpName}] ${route.path} — ${offenders.length} blue text node(s)`);
      } else {
        console.log(`✓ [${vpName}] ${route.path}`);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  `${OUT}/report.json`,
  JSON.stringify({ base: BASE, ids, routes: ROUTES.map((r) => r.path), violations }, null, 2),
);

if (violations.length) {
  console.error(`\nFAIL — ${violations.length} blue text node(s). Report: ${OUT}/report.json`);
  for (const v of violations.slice(0, 25)) {
    console.error(`  [${v.viewport}] ${v.route}  ${v.selector}  ${v.color}  "${v.text}"`);
  }
  process.exit(1);
}
console.log("\nOK — no blue text detected.");
