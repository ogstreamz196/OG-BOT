#!/usr/bin/env node
/**
 * Library page layout + visual regression sweep.
 *
 * Boots Playwright at mobile / tablet / desktop and:
 *   1. asserts computed spacing for hero, "Your Library" header,
 *      and the cards grid matches the locked Tailwind tokens
 *      (gap-4 = 16px, gap-3 = 12px, pb-4 = 16px, pb-20 = 80px, mb-3 = 12px).
 *   2. captures a per-breakpoint screenshot and diffs against the
 *      baseline in tests/visual/baseline/library__<bp>.png.
 *
 * Usage:
 *   node scripts/library-layout-check.mjs                 # diff vs baseline
 *   UPDATE=1 node scripts/library-layout-check.mjs        # refresh baselines
 *
 * Requires a running authenticated dev server on $BASE_URL (default
 * http://localhost:8080) with a signed-in session restored by the caller —
 * see the browser-use guide for the LOVABLE_BROWSER_SUPABASE_* pattern.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const UPDATE = !!process.env.UPDATE;
const THRESHOLD = Number(process.env.THRESHOLD ?? 0.02);

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

// Expected computed spacing in CSS pixels. These mirror the Tailwind
// tokens locked by src/lib/library-layout-tokens.test.ts.
const EXPECTED = {
  "library-root": { rowGap: 16, paddingBottom: 80 },
  "library-hero": { columnGap: 16, paddingBottom: 16 },
  "library-your-header": { columnGap: 12, marginBottom: 12 },
  "library-cards": { rowGap: 12 },
};

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

async function measure(page, testid) {
  return page.$eval(`[data-testid="${testid}"]`, (el) => {
    const s = getComputedStyle(el);
    return {
      rowGap: parseFloat(s.rowGap) || 0,
      columnGap: parseFloat(s.columnGap) || 0,
      paddingBottom: parseFloat(s.paddingBottom) || 0,
      marginBottom: parseFloat(s.marginBottom) || 0,
    };
  });
}

async function diffPng(a, b, outPath) {
  const A = PNG.sync.read(await readFile(a));
  const B = PNG.sync.read(await readFile(b));
  if (A.width !== B.width || A.height !== B.height) return { mismatched: Infinity };
  const out = new PNG({ width: A.width, height: A.height });
  const mismatched = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0.1 });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, PNG.sync.write(out));
  return { mismatched, total: A.width * A.height };
}

async function run() {
  const browser = await chromium.launch();
  const failures = [];

  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/library`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector('[data-testid="library-root"]', { timeout: 10000 });

    // 1. Layout assertions
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const got = await measure(page, id);
      for (const [prop, want] of Object.entries(expected)) {
        if (Math.abs(got[prop] - want) > 0.5) {
          failures.push(`${bp.name} ${id}.${prop} = ${got[prop]}px (expected ${want}px)`);
        }
      }
    }

    // 2. Visual regression
    const cur = `tests/visual/current/library__${bp.name}.png`;
    const base = `tests/visual/baseline/library__${bp.name}.png`;
    await mkdir(dirname(cur), { recursive: true });
    await page.screenshot({ path: cur, fullPage: false });
    if (!(await exists(base)) || UPDATE) {
      await mkdir(dirname(base), { recursive: true });
      await writeFile(base, await readFile(cur));
      console.log(`${UPDATE ? "updated" : "baseline"} library__${bp.name}`);
    } else {
      const { mismatched, total } = await diffPng(
        base,
        cur,
        `tests/visual/diff/library__${bp.name}.png`,
      );
      const ratio = mismatched / (total || 1);
      if (ratio > THRESHOLD) {
        failures.push(
          `${bp.name} visual diff ${(ratio * 100).toFixed(2)}% > ${(THRESHOLD * 100).toFixed(2)}%`,
        );
      }
    }

    await ctx.close();
  }

  await browser.close();
  if (failures.length) {
    console.error("Library layout check failed:\n" + failures.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  }
  console.log("Library layout check passed at mobile / tablet / desktop.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
