#!/usr/bin/env node
/**
 * Visual regression sweep across common device viewports.
 *
 * Usage:
 *   node scripts/visual-regression.mjs                 # capture baselines
 *   UPDATE=1 node scripts/visual-regression.mjs        # overwrite baselines
 *   node scripts/visual-regression.mjs --compare       # diff against baselines
 *
 * Requires a running dev server (default http://localhost:8080) and
 * `bun add -d playwright pixelmatch pngjs` (Playwright already bundled
 * in this sandbox).
 *
 * Output:
 *   tests/visual/baseline/<device>__<slug>.png
 *   tests/visual/current/<device>__<slug>.png
 *   tests/visual/diff/<device>__<slug>.png  (only on failure)
 */
import { chromium, devices } from "playwright";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const UPDATE = !!process.env.UPDATE;
const COMPARE = process.argv.includes("--compare");
const THRESHOLD = Number(process.env.THRESHOLD ?? 0.02); // 2% pixels

const ROUTES = ["/", "/welcome", "/messenger", "/library", "/buy-coins", "/referrals"];

const VIEWPORTS = [
  { name: "iphone-se", ...devices["iPhone SE"] },
  { name: "iphone-15-pro", ...devices["iPhone 15 Pro"] },
  { name: "samsung-s21", ...devices["Galaxy S9+"] }, // closest Android preset
  { name: "ipad-mini", ...devices["iPad Mini"] },
  { name: "ipad-pro-11", ...devices["iPad Pro 11"] },
  { name: "mac-13", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: "win-1080", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
];

const slug = (p) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_"));
const exists = async (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

async function run() {
  const browser = await chromium.launch();
  const failures = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      userAgent: vp.userAgent,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    const page = await ctx.newPage();

    for (const route of ROUTES) {
      const id = `${vp.name}__${slug(route)}`;
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 15000 });
        await page.waitForTimeout(300);
      } catch (err) {
        console.warn(`skip ${id}: ${err.message}`);
        continue;
      }

      const baselinePath = `tests/visual/baseline/${id}.png`;
      const currentPath = `tests/visual/current/${id}.png`;
      const diffPath = `tests/visual/diff/${id}.png`;
      await mkdir(dirname(currentPath), { recursive: true });
      await page.screenshot({ path: currentPath, fullPage: false });

      const hasBaseline = await exists(baselinePath);
      if (!hasBaseline || UPDATE) {
        await mkdir(dirname(baselinePath), { recursive: true });
        await writeFile(baselinePath, await readFile(currentPath));
        console.log(`${UPDATE ? "updated" : "baseline"} ${id}`);
        continue;
      }
      if (!COMPARE) continue;

      const a = PNG.sync.read(await readFile(baselinePath));
      const b = PNG.sync.read(await readFile(currentPath));
      if (a.width !== b.width || a.height !== b.height) {
        failures.push(`${id}: size changed ${a.width}x${a.height} -> ${b.width}x${b.height}`);
        continue;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const mismatch = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
      const ratio = mismatch / (a.width * a.height);
      if (ratio > THRESHOLD) {
        await mkdir(dirname(diffPath), { recursive: true });
        await writeFile(diffPath, PNG.sync.write(diff));
        failures.push(`${id}: ${(ratio * 100).toFixed(2)}% pixels differ`);
      }
    }
    await ctx.close();
  }

  await browser.close();
  if (failures.length) {
    console.error("\nVisual regressions:");
    failures.forEach((f) => console.error("  -", f));
    process.exit(1);
  }
  console.log("\nVisual sweep ok");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
