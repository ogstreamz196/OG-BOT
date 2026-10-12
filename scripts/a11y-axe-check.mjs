#!/usr/bin/env node
/**
 * Playwright + axe-core a11y regression check.
 *
 * Visits critical routes and runs @axe-core/playwright with WCAG 2.1 AA
 * rules (covers ARIA roles, names, contrast, and landmarks). Fails (exit 1)
 * on any "serious" or "critical" violation; "minor"/"moderate" are logged.
 *
 * Requires: bun add -d @axe-core/playwright playwright
 *
 * Usage:
 *   node scripts/a11y-axe-check.mjs
 *   BASE_URL=http://localhost:8080 ROUTES=/,/library node scripts/a11y-axe-check.mjs
 */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const ROUTES = (process.env.ROUTES ?? "/,/library,/messenger,/store,/referrals").split(",");
const FAIL_IMPACT = new Set(["serious", "critical"]);

const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "domcontentloaded" });
if (storageKey && sessionJson) {
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);
}

let hadFailure = false;

for (const route of ROUTES) {
  const url = new URL(route, BASE).toString();
  await page.goto(url, { waitUntil: "networkidle" });

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = violations.filter((v) => FAIL_IMPACT.has(v.impact ?? ""));
  const advisory = violations.filter((v) => !FAIL_IMPACT.has(v.impact ?? ""));

  if (blocking.length === 0 && advisory.length === 0) {
    console.log(`✓ ${route} — no violations`);
    continue;
  }

  console.log(`\n${route}`);
  for (const v of blocking) {
    hadFailure = true;
    console.log(`  ✗ [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
    console.log(`     ${v.helpUrl}`);
  }
  for (const v of advisory) {
    console.log(`  · [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
  }
}

await browser.close();
process.exit(hadFailure ? 1 : 0);
