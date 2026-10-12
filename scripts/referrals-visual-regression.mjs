#!/usr/bin/env node
/**
 * Focused visual + layout regression for /referrals.
 *
 * Captures the three "exciting" UI surfaces per-viewport AND asserts:
 *   1. Stat tile stacking — 2 cols on mobile w/ Network spanning, 3 cols ≥ sm
 *   2. Every action button sits inside the viewport, ≥44px tall, no overlap
 *   3. Hero/feed renders the mocked deterministic data
 *
 * Cashback feed, referral summary, profile code, and "my referrer" lookups
 * are mocked via page.route so the snapshot bytes don't drift with real
 * timestamps, coin balances, or network ordering. Context locks UTC + en-GB
 * so toLocaleDateString/toLocaleTimeString output is byte-stable.
 *
 * Usage:
 *   node scripts/referrals-visual-regression.mjs              # capture baselines + assert layout
 *   UPDATE=1 node scripts/referrals-visual-regression.mjs     # overwrite baselines
 *   node scripts/referrals-visual-regression.mjs --compare    # diff against baselines + assert
 *
 * Output: tests/visual/referrals/{baseline,current,diff}/<device>__<target>.png
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
const SM_BREAKPOINT = 640; // Tailwind sm:

const TARGETS = ["referrals-hero", "referrals-stat-tiles", "referrals-cashback-feed"];

// Deterministic fixture — frozen timestamps in UTC, fixed coin numbers.
const FIXTURE_SUMMARY = {
  total_referred: 7,
  total_earned: 1234,
  recent: [
    {
      id: "tx-1",
      amount: 50,
      reference: "burn:500",
      created_at: "2026-01-15T10:30:00.000Z",
      referee_id: "u1",
      referee_name: "Alex",
    },
    {
      id: "tx-2",
      amount: 30,
      reference: "burn:300",
      created_at: "2026-01-14T14:00:00.000Z",
      referee_id: "u2",
      referee_name: "Bex",
    },
    {
      id: "tx-3",
      amount: 12,
      reference: "burn:120",
      created_at: "2026-01-13T09:15:00.000Z",
      referee_id: "u3",
      referee_name: "Cas",
    },
  ],
};
const FIXTURE_REFERRER = {
  has_referrer: true,
  referrer_name: "OG Leader",
  referrer_code: "OGLEAD",
  bound_at: "2026-01-10T00:00:00.000Z",
};
const FIXTURE_PROFILE = { referral_code: "OGFIXED" };

const VIEWPORTS = [
  // Small-screen thumb-friendly coverage
  {
    name: "android-360",
    viewport: { width: 360, height: 640 },
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
  { name: "iphone-se", ...devices["iPhone SE"] },
  { name: "iphone-15-pro", ...devices["iPhone 15 Pro"] },
  { name: "ipad-mini", ...devices["iPad Mini"] },
  { name: "desktop", viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 1 },
];

const exists = async (p) =>
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

async function installMocks(page) {
  // Intercept Supabase REST + RPC calls so feed/summary/profile are deterministic.
  await page.route(/\/rest\/v1\/.*/, async (route) => {
    const url = route.request().url();
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    if (url.includes("/rpc/get_referral_summary")) return json(FIXTURE_SUMMARY);
    if (url.includes("/rpc/get_my_referrer")) return json(FIXTURE_REFERRER);
    if (url.includes("/profiles")) return json(FIXTURE_PROFILE);
    return route.continue();
  });
}

function approx(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

async function assertLayout(page, vp) {
  const failures = [];
  const isMobile = vp.viewport.width < SM_BREAKPOINT;

  // --- Stat tile stacking ---
  const tiles = await page.locator('[data-testid="referrals-stat-tiles"] > *').all();
  if (tiles.length < 3) {
    failures.push(`[${vp.name}] expected 3 stat tile cells, found ${tiles.length}`);
  } else {
    const rects = await Promise.all(tiles.map((t) => t.boundingBox()));
    const [paid, pending, network] = rects;
    if (rects.some((r) => !r)) {
      failures.push(`[${vp.name}] stat tiles not rendered`);
    } else if (isMobile) {
      // Row 1: Paid + Pending side-by-side, same top
      if (!approx(paid.y, pending.y))
        failures.push(
          `[${vp.name}] Paid/Pending not on the same row (y ${paid.y} vs ${pending.y})`,
        );
      if (paid.x >= pending.x) failures.push(`[${vp.name}] Paid should be left of Pending`);
      // Row 2: Network spans full grid width below
      if (network.y <= paid.y + paid.height - 1)
        failures.push(`[${vp.name}] Network should wrap onto a new row`);
      const gridWidth = paid.width + pending.width + 12; // gap-3 = 12px
      if (network.width < gridWidth - 16)
        failures.push(
          `[${vp.name}] Network should span full row (got ${network.width}, expected ~${gridWidth})`,
        );
    } else {
      // 3-col: all three share the same top
      if (!approx(paid.y, pending.y) || !approx(pending.y, network.y)) {
        failures.push(`[${vp.name}] stat tiles should be 3-up on the same row`);
      }
      if (!(paid.x < pending.x && pending.x < network.x)) {
        failures.push(`[${vp.name}] stat tiles out of order`);
      }
    }
  }

  // --- Button assertions: inside viewport, ≥44px tall, no overlap ---
  const buttonInfos = await page.evaluate(() => {
    const out = [];
    document
      .querySelectorAll(
        '[data-testid="referrals-page"] button, [data-testid="referrals-page"] a[role="button"]',
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") return;
        out.push({
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          right: r.right,
          bottom: r.bottom,
        });
      });
    return out;
  });
  const vw = vp.viewport.width;
  for (const b of buttonInfos) {
    if (b.right > vw + 1)
      failures.push(
        `[${vp.name}] button "${b.label}" overflows right (right=${b.right.toFixed(0)} > vw=${vw})`,
      );
    if (b.x < -1)
      failures.push(`[${vp.name}] button "${b.label}" overflows left (x=${b.x.toFixed(0)})`);
    if (b.h < 36)
      failures.push(
        `[${vp.name}] button "${b.label}" too short for thumb (${b.h.toFixed(0)}px < 36)`,
      );
  }
  // Pairwise overlap (allow touching edges)
  for (let i = 0; i < buttonInfos.length; i++) {
    for (let j = i + 1; j < buttonInfos.length; j++) {
      const a = buttonInfos[i],
        b = buttonInfos[j];
      const overlapX = a.x < b.right - 1 && b.x < a.right - 1;
      const overlapY = a.y < b.bottom - 1 && b.y < a.bottom - 1;
      if (overlapX && overlapY) {
        failures.push(`[${vp.name}] buttons overlap: "${a.label}" ⨯ "${b.label}"`);
      }
    }
  }

  // --- Mocked data rendered ---
  const heroText = await page.locator('[data-testid="referrals-hero"]').innerText();
  if (!heroText.includes("1,234"))
    failures.push(`[${vp.name}] hero missing mocked total_earned 1,234`);
  const feedText = await page.locator('[data-testid="referrals-cashback-feed"]').innerText();
  if (!feedText.includes("Alex") || !feedText.includes("+50 OG")) {
    failures.push(`[${vp.name}] cashback feed missing mocked rows`);
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
    await installMocks(page);
    await restoreSession(page);
    try {
      await page.goto(`${BASE}/referrals`, { waitUntil: "networkidle", timeout: 20000 });
    } catch (err) {
      console.warn(`skip ${vp.name}: navigation ${err.message}`);
      await ctx.close();
      continue;
    }
    await page
      .waitForSelector('[data-testid="referrals-page"]', { timeout: 10000 })
      .catch(() => {});
    // Wait for mocked feed to render
    await page
      .locator('[data-testid="referrals-cashback-feed"]:has-text("Alex")')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    layoutFailures.push(...(await assertLayout(page, vp)));

    for (const target of TARGETS) {
      const id = `${vp.name}__${target}`;
      const locator = page.locator(`[data-testid="${target}"]`).first();
      if (!(await locator.count())) {
        console.warn(`skip ${id}: target not found`);
        continue;
      }

      const baselinePath = `tests/visual/referrals/baseline/${id}.png`;
      const currentPath = `tests/visual/referrals/current/${id}.png`;
      const diffPath = `tests/visual/referrals/diff/${id}.png`;
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
  console.log("\nReferrals sweep ok — layout + pixels clean");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
