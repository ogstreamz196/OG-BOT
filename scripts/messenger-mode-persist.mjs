#!/usr/bin/env node
/**
 * E2E: open messenger, toggle Community mode, refresh, verify persistence.
 * Requires LOVABLE_BROWSER_SUPABASE_* session env vars (managed Supabase).
 *
 * Usage: node scripts/messenger-mode-persist.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:8080";
const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

if (!storageKey || !sessionJson) {
  console.error("Missing LOVABLE_BROWSER_SUPABASE_* env (sign in via preview first).");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);

  await page.goto(`${BASE}/messenger`, { waitUntil: "networkidle" });
  // Force loner first to normalize starting state
  const lonerBtn = page.getByRole("button", { name: /private mode|loner/i });
  if (await lonerBtn.count())
    await lonerBtn
      .first()
      .click()
      .catch(() => {});

  // Click Community
  const community = page.getByRole("button", { name: /community/i }).first();
  await community.waitFor({ state: "visible", timeout: 10_000 });
  await community.click();
  await page.waitForTimeout(800);

  // Refresh
  await page.reload({ waitUntil: "networkidle" });

  // Verify persisted
  const stillCommunity = await page
    .locator('[aria-pressed="true"]', { hasText: /community/i })
    .or(page.getByText(/community mode/i))
    .first()
    .isVisible({ timeout: 10_000 });

  if (!stillCommunity) {
    console.error("FAIL: Community mode did not persist after refresh.");
    await page.screenshot({ path: "/tmp/messenger-mode-fail.png" });
    process.exit(1);
  }
  console.log("PASS: messenger_mode persisted as community across refresh.");
} finally {
  await browser.close();
}
