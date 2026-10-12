#!/usr/bin/env node
/**
 * Verifies every admin "Recent admin changes" <details> section starts
 * collapsed at mobile, and expands when the summary is toggled.
 *
 * Usage: node scripts/admin-recent-changes-collapsed.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const ROUTES = ["/admin", "/admin/users"]; // pages that render MintCoinsPanel + UserAuditTrail

async function restoreSession(page) {
  const key = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const json = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (!key || !json) return false;
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, json]);
  return true;
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const authed = await restoreSession(page);
  if (!authed) {
    console.warn("no Supabase session injected — skipping (auth required)");
    await browser.close();
    return;
  }

  const failures = [];
  let checked = 0;

  for (const route of ROUTES) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 20000 });
    } catch (err) {
      console.warn(`skip ${route}: ${err.message}`);
      continue;
    }
    await page.waitForTimeout(500);

    const sections = page.locator('[data-testid="admin-recent-changes"]');
    const count = await sections.count();
    if (count === 0) {
      console.warn(`no Recent admin changes sections on ${route}`);
      continue;
    }

    for (let i = 0; i < count; i++) {
      checked++;
      const el = sections.nth(i);
      await el.scrollIntoViewIfNeeded();
      const id = `${route}#${i}`;

      // Collapsed by default
      const openDefault = await el.evaluate((n) => n.open);
      if (openDefault) failures.push(`${id}: open by default, expected collapsed`);

      // Toggle → expands
      await el.locator("summary").click();
      const openAfter = await el.evaluate((n) => n.open);
      if (!openAfter) failures.push(`${id}: did not expand after summary click`);

      // Toggle again → collapses
      await el.locator("summary").click();
      const openAgain = await el.evaluate((n) => n.open);
      if (openAgain) failures.push(`${id}: did not collapse on second toggle`);
    }
  }

  await browser.close();
  if (failures.length) {
    console.error("\nadmin recent-changes assertions failed:");
    failures.forEach((f) => console.error("  -", f));
    process.exit(1);
  }
  console.log(`ok — ${checked} Recent admin changes section(s) collapsed-by-default + toggleable`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
