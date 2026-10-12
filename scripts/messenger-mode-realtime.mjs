#!/usr/bin/env node
/**
 * Cross-session realtime test:
 * 1. Open messenger in browser session A.
 * 2. From a separate Supabase client (session B / "another device"),
 *    flip user_preferences.messenger_mode.
 * 3. Verify session A's UI updates WITHOUT a refresh.
 *
 * Requires LOVABLE_BROWSER_SUPABASE_* env vars.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:8080";
const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supaKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!storageKey || !sessionJson || !supaUrl || !supaKey) {
  console.error("Missing Supabase session/env. Sign in via preview first.");
  process.exit(2);
}

const session = JSON.parse(sessionJson);
const userId = session?.user?.id;
if (!userId) {
  console.error("Session JSON has no user.id");
  process.exit(2);
}

// "Other device": independent Supabase client authenticated as the same user.
const sideClient = createClient(supaUrl, supaKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sideClient.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, sessionJson]);

  // Seed to loner first.
  await sideClient
    .from("user_preferences")
    .upsert({ user_id: userId, messenger_mode: "loner" }, { onConflict: "user_id" });

  await page.goto(`${BASE}/messenger`, { waitUntil: "networkidle" });
  const toggle = page.getByRole("switch").first();
  await toggle.waitFor({ state: "visible", timeout: 10_000 });

  // Confirm starting state: aria-checked="false" => loner.
  const startChecked = await toggle.getAttribute("aria-checked");
  if (startChecked !== "false") {
    console.error(`Expected aria-checked=false (loner) at start, got ${startChecked}`);
    process.exit(1);
  }

  // Flip from "another device" — no UI interaction.
  await sideClient
    .from("user_preferences")
    .upsert({ user_id: userId, messenger_mode: "community" }, { onConflict: "user_id" });

  // Wait for realtime push to update aria-checked WITHOUT a refresh.
  await page.waitForFunction(
    () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true",
    null,
    { timeout: 10_000 },
  );

  console.log("PASS: messenger UI updated via realtime without refresh.");
} catch (e) {
  console.error("FAIL:", e?.message || e);
  await page.screenshot({ path: "/tmp/messenger-mode-realtime-fail.png" });
  process.exit(1);
} finally {
  await browser.close();
}
