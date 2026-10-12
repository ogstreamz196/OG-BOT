#!/usr/bin/env node
/**
 * Visual regression check for the dashboard name paint-drip in dark mode.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/ui-check-paint-drip.mjs
 *
 * Requires an authenticated session cookie / localStorage to view `/`. In CI
 * inject the Supabase session via LOVABLE_BROWSER_SUPABASE_* env vars (see
 * the browser-use guide). Writes a PNG of the name lockup to
 * /tmp/browser/paint-drip/name.png and fails (exit 1) if:
 *   - the .paint-drip element is missing
 *   - <html> is not in dark mode
 *   - the ::after drip layer is not rendered
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const OUT_DIR = "/tmp/browser/paint-drip";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await context.newPage();

const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
if (storageKey && sessionJson) {
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);
}
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

const name = page.locator(".paint-drip").first();
await name.waitFor({ state: "visible", timeout: 10_000 });

const audit = await page.evaluate(() => {
  const html = document.documentElement;
  const el = document.querySelector(".paint-drip");
  if (!el) return { ok: false, reason: "no .paint-drip element" };
  const after = getComputedStyle(el, "::after");
  return {
    ok: true,
    darkMode: html.classList.contains("dark"),
    afterContent: after.content,
    afterAnimation: after.animationName,
    afterBackground: after.backgroundImage.slice(0, 120),
  };
});

await name.screenshot({ path: join(OUT_DIR, "name.png") });
await page.screenshot({ path: join(OUT_DIR, "hero.png") });
await browser.close();

const failures = [];
if (!audit.darkMode) failures.push("html is not in dark mode");
if (audit.afterContent === "none") failures.push("paint-drip ::after not rendered");
if (!audit.afterAnimation?.includes("paint-drip-fall"))
  failures.push(`expected paint-drip-fall animation, got ${audit.afterAnimation}`);

console.log(JSON.stringify({ audit, screenshot: join(OUT_DIR, "name.png") }, null, 2));
if (failures.length) {
  console.error("paint-drip regressions:\n - " + failures.join("\n - "));
  process.exit(1);
}
