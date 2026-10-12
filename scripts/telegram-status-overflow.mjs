#!/usr/bin/env node
/**
 * Playwright assertions: the Telegram status card text never overflows its
 * container at mobile and tablet viewports.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/telegram-status-overflow.mjs
 *
 * Exits non-zero if any text node overflows horizontally OR vertically out of
 * the card bounds, or if the headline font-size exceeds the 1.5rem (24px) cap.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const ROUTE = process.env.TELEGRAM_STATUS_ROUTE ?? "/";
const VIEWPORTS = [
  { name: "mobile-small", width: 320, height: 720 },
  { name: "mobile", width: 375, height: 812 },
  { name: "mobile-large", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-large", width: 1024, height: 1366 },
];
const HEADLINE_MAX_PX = 24; // clamp() upper bound = 1.5rem
const DETAIL_MAX_PX = 16; // clamp() upper bound = 1rem

const failures = [];

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("telegram-status-card");
    if ((await card.count()) === 0) {
      console.log(`[${vp.name}] card not rendered (likely signed out) — skipping`);
      await ctx.close();
      continue;
    }
    await card.first().waitFor({ state: "visible", timeout: 5_000 });

    const metrics = await card.first().evaluate((el) => {
      const headline = el.querySelector('[data-testid="telegram-status-headline"]');
      const detail = el.querySelector('[data-testid="telegram-status-detail"]');
      const cardRect = el.getBoundingClientRect();
      const read = (node) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        return {
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
          left: r.left,
          top: r.top,
          fontSize: parseFloat(cs.fontSize),
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
        };
      };
      return {
        card: {
          left: cardRect.left,
          right: cardRect.right,
          top: cardRect.top,
          bottom: cardRect.bottom,
          width: cardRect.width,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        },
        headline: read(headline),
        detail: read(detail),
      };
    });

    const tol = 1; // sub-pixel rounding
    const check = (label, node, maxFont) => {
      if (!node) {
        failures.push(`[${vp.name}] ${label} missing`);
        return;
      }
      if (node.right > metrics.card.right + tol) {
        failures.push(
          `[${vp.name}] ${label} overflows right edge (${node.right.toFixed(1)} > ${metrics.card.right.toFixed(1)})`,
        );
      }
      if (node.scrollWidth > node.clientWidth + tol) {
        failures.push(
          `[${vp.name}] ${label} scrollWidth ${node.scrollWidth} exceeds clientWidth ${node.clientWidth}`,
        );
      }
      if (node.fontSize > maxFont + 0.5) {
        failures.push(
          `[${vp.name}] ${label} font-size ${node.fontSize}px exceeds cap ${maxFont}px`,
        );
      }
    };

    if (metrics.card.scrollWidth > metrics.card.clientWidth + tol) {
      failures.push(
        `[${vp.name}] card itself overflows (scrollWidth ${metrics.card.scrollWidth} > clientWidth ${metrics.card.clientWidth})`,
      );
    }

    check("headline", metrics.headline, HEADLINE_MAX_PX);
    check("detail", metrics.detail, DETAIL_MAX_PX);

    console.log(
      `[${vp.name}] card=${metrics.card.width.toFixed(0)}px  headline=${metrics.headline?.fontSize}px  detail=${metrics.detail?.fontSize}px`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nTelegram status overflow assertions FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nAll Telegram status overflow assertions passed.");
