#!/usr/bin/env node
/**
 * Visual regression check for the /welcome H1 heading across viewport widths.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/ui-check-welcome-heading.mjs
 *
 * Renders /welcome at mobile (375), tablet (768), laptop (1024) and desktop
 * (1440) widths, screenshots the H1, and fails (exit 1) if:
 *   - the H1 is missing
 *   - the heading visibly overflows its container at any width
 *   - the font-size falls outside a sensible per-width range
 * PNGs are written to /tmp/browser/welcome-heading/<width>.png.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const OUT_DIR = "/tmp/browser/welcome-heading";
mkdirSync(OUT_DIR, { recursive: true });

// width → [minFontPx, maxFontPx] sanity bounds (matches clamp() in welcome.tsx)
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 800, font: [32, 88] },
  { name: "tablet", width: 768, height: 1024, font: [40, 140] },
  { name: "laptop", width: 1024, height: 900, font: [56, 170] },
  { name: "desktop", width: 1440, height: 900, font: [72, 200] },
];

const browser = await chromium.launch({ headless: true });
const failures = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/welcome`, { waitUntil: "networkidle" });

  const h1 = page.locator("h1").first();
  if ((await h1.count()) === 0) {
    failures.push(`[${vp.name}] H1 not found`);
    await context.close();
    continue;
  }

  await h1.screenshot({ path: join(OUT_DIR, `${vp.name}.png`) });

  const stats = await h1.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: parseFloat(cs.fontSize),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      offsetParentWidth: el.parentElement?.clientWidth ?? 0,
    };
  });

  const overflow = stats.scrollWidth - stats.clientWidth > 1;
  const [lo, hi] = vp.font;
  const oob = stats.fontSize < lo || stats.fontSize > hi;
  if (overflow)
    failures.push(`[${vp.name}] H1 overflows (${stats.scrollWidth} > ${stats.clientWidth})`);
  if (oob) failures.push(`[${vp.name}] font-size ${stats.fontSize}px outside [${lo}, ${hi}]`);

  console.log(
    `[${vp.name}] ${vp.width}px → ${stats.fontSize.toFixed(1)}px font, ${stats.scrollWidth}/${stats.clientWidth} sw/cw`,
  );
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error("\nWelcome heading regression check FAILED:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("\nWelcome heading OK across all viewports.");
