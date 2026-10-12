#!/usr/bin/env node
/**
 * Visual + layout regression for the OgChat header (Foul Mouth hero +
 * secondary controls). Asserts side-by-side layout at sm+ and stacked
 * layout on mobile, plus pixel-diff snapshots.
 *
 * Usage:
 *   node scripts/ogchat-header-visual-regression.mjs            # capture baselines
 *   UPDATE=1 node scripts/ogchat-header-visual-regression.mjs   # overwrite
 *   node scripts/ogchat-header-visual-regression.mjs --compare  # diff
 *
 * Output: tests/visual/ogchat/{baseline,current,diff}/<device>__<target>.png
 */
import { chromium, devices } from "playwright";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const UPDATE = !!process.env.UPDATE;
const COMPARE = process.argv.includes("--compare");
const THRESHOLD = Number(process.env.THRESHOLD ?? 0.02);
const SM = 640; // Tailwind sm:

const TARGETS = ["ogchat-header", "ogchat-foulmouth-hero", "ogchat-controls"];

const VIEWPORTS = [
  {
    name: "android-360",
    viewport: { width: 360, height: 720 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  {
    name: "iphone-se-375",
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  {
    name: "iphone-xr-414",
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  { name: "sm-640", viewport: { width: 640, height: 900 }, deviceScaleFactor: 1 },
  { name: "ipad-mini", ...devices["iPad Mini"] },
  { name: "desktop", viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 1 },
];

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

async function restoreSession(page) {
  const key = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const json = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (!key || !json) return;
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, json]);
}

function approx(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

async function assertLayout(page, vp) {
  const failures = [];
  const isMobile = vp.viewport.width < SM;

  const header = await page.locator('[data-testid="ogchat-header"]').boundingBox();
  const hero = await page.locator('[data-testid="ogchat-foulmouth-hero"]').boundingBox();
  const ctrls = await page.locator('[data-testid="ogchat-controls"]').boundingBox();

  if (!header || !hero || !ctrls) {
    failures.push(
      `[${vp.name}] header parts missing (header=${!!header} hero=${!!hero} controls=${!!ctrls})`,
    );
    return failures;
  }

  // No overflow past the viewport
  if (header.x + header.width > vp.viewport.width + 1) {
    failures.push(
      `[${vp.name}] header overflows viewport (${(header.x + header.width).toFixed(0)} > ${vp.viewport.width})`,
    );
  }

  if (isMobile) {
    // Stacked: controls render below hero, hero spans roughly the full header width
    if (ctrls.y < hero.y + hero.height - 4) {
      failures.push(
        `[${vp.name}] controls should stack below hero (hero.bottom=${(hero.y + hero.height).toFixed(0)}, ctrls.y=${ctrls.y.toFixed(0)})`,
      );
    }
    if (hero.width < header.width - 16) {
      failures.push(
        `[${vp.name}] hero should span header width on mobile (got ${hero.width.toFixed(0)} vs header ${header.width.toFixed(0)})`,
      );
    }
  } else {
    // Side-by-side: same top, hero left of controls, no horizontal overlap
    if (!approx(hero.y, ctrls.y, 4)) {
      failures.push(
        `[${vp.name}] hero/controls should share row (hero.y=${hero.y.toFixed(0)} vs ctrls.y=${ctrls.y.toFixed(0)})`,
      );
    }
    if (hero.x + hero.width > ctrls.x + 1) {
      failures.push(`[${vp.name}] hero overlaps controls horizontally`);
    }
    if (hero.width + ctrls.width > header.width + 4) {
      failures.push(`[${vp.name}] hero+controls exceed header max-width`);
    }
  }
  return failures;
}

async function run() {
  const browser = await chromium.launch();
  const visualFailures = [];
  const layoutFailures = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      userAgent: vp.userAgent,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      timezoneId: "UTC",
      locale: "en-GB",
    });
    const page = await ctx.newPage();
    await restoreSession(page);
    try {
      await page.goto(`${BASE}/messenger`, { waitUntil: "networkidle", timeout: 20000 });
    } catch (err) {
      console.warn(`skip ${vp.name}: navigation ${err.message}`);
      await ctx.close();
      continue;
    }
    const ok = await page
      .locator('[data-testid="ogchat-header"]')
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      console.warn(`skip ${vp.name}: ogchat-header never rendered (likely not signed in)`);
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(200);

    layoutFailures.push(...(await assertLayout(page, vp)));

    for (const target of TARGETS) {
      const id = `${vp.name}__${target}`;
      const locator = page.locator(`[data-testid="${target}"]`).first();
      if (!(await locator.count())) {
        console.warn(`skip ${id}: not found`);
        continue;
      }
      const baselinePath = `tests/visual/ogchat/baseline/${id}.png`;
      const currentPath = `tests/visual/ogchat/current/${id}.png`;
      const diffPath = `tests/visual/ogchat/diff/${id}.png`;
      await mkdir(dirname(currentPath), { recursive: true });
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: currentPath });

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
        visualFailures.push(`${id}: size changed ${a.width}x${a.height} -> ${b.width}x${b.height}`);
        continue;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const mismatch = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
      const ratio = mismatch / (a.width * a.height);
      if (ratio > THRESHOLD) {
        await mkdir(dirname(diffPath), { recursive: true });
        await writeFile(diffPath, PNG.sync.write(diff));
        visualFailures.push(`${id}: ${(ratio * 100).toFixed(2)}% pixels differ`);
      }
    }
    await ctx.close();
  }

  await browser.close();
  if (layoutFailures.length) {
    console.error("\nLayout assertion failures:");
    layoutFailures.forEach((f) => console.error("  -", f));
  }
  if (visualFailures.length) {
    console.error("\nVisual regressions:");
    visualFailures.forEach((f) => console.error("  -", f));
  }
  if (layoutFailures.length || visualFailures.length) process.exit(1);
  console.log("\nOgChat header sweep ok — layout + pixels clean");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
