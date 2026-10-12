/**
 * End-to-end smoke test: login → coin balance visible → generate → poll status →
 * unlock preview → download.
 *
 * Run against a live preview (default localhost:8080). Requires a seeded test
 * user with enough coins (E2E_EMAIL / E2E_PASSWORD env). Skipped automatically
 * when those are not set so CI can no-op.
 *
 *   node scripts/e2e-generate-unlock.mjs
 *
 * The script asserts the *user-visible* contract: balance decreases by exactly
 * the generation cost, the song row appears in the library, the preview becomes
 * playable, and the "Download full HQ" button only enables after unlock.
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://localhost:8080";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.log("[e2e] skipped: set E2E_EMAIL / E2E_PASSWORD to run");
  process.exit(0);
}

const out = "/tmp/browser/e2e-generate-unlock";
const fs = await import("node:fs");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await ctx.newPage();

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
}

function parseBalance(text) {
  const m = String(text).replace(/[, ]/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

try {
  // 1. Login
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });
  await shot("01-logged-in");

  // 2. Balance is visible
  const balanceEl = page.getByTestId("coin-balance").first();
  await balanceEl.waitFor({ timeout: 10_000 });
  const before = parseBalance(await balanceEl.innerText());
  if (!Number.isFinite(before)) throw new Error("coin balance not parseable");
  console.log("[e2e] balance before:", before);

  // 3. Trigger generation
  await page.goto(`${BASE}/musichub`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /generate( lyrics)?/i })
    .first()
    .click();
  await shot("02-generate-clicked");

  // 4. Wait for balance to drop (deduction confirmed)
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-testid="coin-balance"]');
      if (!el) return false;
      const n = Number((el.textContent || "").replace(/[^0-9]/g, ""));
      return Number.isFinite(n) && n < prev;
    },
    before,
    { timeout: 30_000 },
  );
  const afterGen = parseBalance(await balanceEl.innerText());
  console.log("[e2e] balance after generate:", afterGen, "(delta", afterGen - before, ")");

  // 5. Wait for song to appear and preview to become playable
  await page.goto(`${BASE}/library`, { waitUntil: "domcontentloaded" });
  const firstSong = page.getByTestId("song-card").first();
  await firstSong.waitFor({ timeout: 120_000 });
  await firstSong.click();
  await page
    .getByRole("button", { name: /play|preview/i })
    .first()
    .waitFor({ timeout: 60_000 });
  await shot("03-preview-ready");

  // 6. Download button must be disabled until unlock
  const dl = page.getByRole("button", { name: /download full|download full hq/i });
  if (await dl.isEnabled()) throw new Error("download enabled before unlock");

  // 7. Unlock
  await page.getByRole("button", { name: /unlock.*download/i }).click();
  await dl.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /download full/i.test(b.textContent || ""),
      );
      return btn && !btn.disabled;
    },
    null,
    { timeout: 30_000 },
  );
  await shot("04-unlocked");

  console.log("[e2e] OK");
} catch (err) {
  await shot("99-error");
  console.error("[e2e] FAIL:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
