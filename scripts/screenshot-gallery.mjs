#!/usr/bin/env node
/**
 * Responsive screenshot gallery for messenger + library.
 *
 * Captures /messenger and /library at mobile (390), tablet (820) and
 * desktop (1440) and writes them to /mnt/documents/screenshots-gallery/
 * (or $OUT_DIR) so you can scrub UI issues side by side.
 *
 * Requires a dev server on $BASE_URL (default http://localhost:8080) and a
 * signed-in browser session restored via the LOVABLE_BROWSER_SUPABASE_*
 * env vars (see browser-use guide). Without a session the screenshots
 * fall back to the public splash for each route.
 *
 * Usage:
 *   node scripts/screenshot-gallery.mjs
 *   BASE_URL=http://localhost:5173 node scripts/screenshot-gallery.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const OUT = process.env.OUT_DIR ?? "/mnt/documents/screenshots-gallery";
const ROUTES = ["/messenger", "/library"];
const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

await mkdir(OUT, { recursive: true });

const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

const browser = await chromium.launch({ headless: true });
const captured = [];

try {
  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    if (storageKey && sessionJson) {
      await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);
    }
    for (const route of ROUTES) {
      const slug = route.replace(/^\//, "").replace(/\//g, "_") || "home";
      const file = `${OUT}/${slug}__${bp.name}.png`;
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: file });
      captured.push(file);
      console.log(`captured ${route} @ ${bp.name} → ${file}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\nDone. ${captured.length} screenshots in ${OUT}`);
