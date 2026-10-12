#!/usr/bin/env node
/**
 * Mobile overlap / overflow detection for the main routes.
 *
 * Visits /, /messenger, /library, /store, /referrals at 390px and fails if:
 *   - the document scrolls horizontally (scrollWidth > clientWidth + 1), or
 *   - any interactive/text element extends beyond the viewport right edge.
 *
 * Decorative absolutes (pointer-events-none, aria-hidden, role=presentation)
 * are intentionally clipped by `html, body { overflow-x: hidden }` in
 * src/styles.css and are ignored.
 *
 * Exits 0 on clean, 1 on any failure. Designed for CI.
 *
 * Usage:
 *   node scripts/mobile-overlap-check.mjs
 *   BASE_URL=http://localhost:5173 node scripts/mobile-overlap-check.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const ROUTES = ["/", "/messenger", "/library", "/store", "/referrals"];
const VIEWPORT = { width: 390, height: 844 };

const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "domcontentloaded" });
if (storageKey && sessionJson) {
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);
}

const failures = [];

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const result = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const horizontalScroll = doc.scrollWidth - doc.clientWidth;
    const offenders = [];
    const SKIP_TAGS = new Set(["HTML", "BODY", "HEAD", "SCRIPT", "STYLE"]);
    document.querySelectorAll("*").forEach((el) => {
      if (SKIP_TAGS.has(el.tagName)) return;
      // Skip purely decorative elements — they're clipped by body overflow.
      if (el.getAttribute("aria-hidden") === "true") return;
      if (el.getAttribute("role") === "presentation") return;
      const style = window.getComputedStyle(el);
      if (style.pointerEvents === "none") return;
      if (style.visibility === "hidden" || style.display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // Only flag content that actually escapes the viewport AND isn't
      // wider than the viewport itself (those are layout bugs vs huge media).
      if (r.right > vw + 1 && r.width <= vw + 1) {
        offenders.push({
          tag: el.tagName,
          cls: String(el.className || "").slice(0, 100),
          text: (el.textContent || "").trim().slice(0, 60),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    });
    return { horizontalScroll, offenders: offenders.slice(0, 15) };
  }, VIEWPORT.width);

  const routeFailed = result.horizontalScroll > 1 || result.offenders.length > 0;
  const tag = routeFailed ? "FAIL" : "ok";
  console.log(
    `[${tag}] ${route}  scroll=${result.horizontalScroll}px  offenders=${result.offenders.length}`,
  );
  if (routeFailed) {
    failures.push({ route, ...result });
    result.offenders.slice(0, 5).forEach((o) => {
      console.log(`   ↳ <${o.tag}> right=${o.right}px width=${o.width}px "${o.text}"  ${o.cls}`);
    });
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} route(s) overflow at ${VIEWPORT.width}px.`);
  process.exit(1);
}
console.log(`\nAll ${ROUTES.length} routes clean at ${VIEWPORT.width}px.`);
