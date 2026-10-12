#!/usr/bin/env node
/**
 * CI guard: fail if the AppShell <main> (or a MusicHub shell) re-introduces
 * mobile scroll-trap styles.
 *
 * Trap = any of the following applied directly to <main>:
 *   - overflow-y-auto / overflow-y-scroll / overflow-auto / overflow-scroll
 *   - overscroll-y-contain / overscroll-y-none / overscroll-contain
 *   - touch-action: pan-y / none / manipulation (inline or class)
 *
 * When <main> is the scroller AND clamps overscroll or hijacks touch-action,
 * one-finger swipes get eaten by main and never reach the document scroller —
 * this is the exact bug we fixed. Keep <main> passive; let the document scroll.
 *
 * Shared *.css utility classes are fine — the ban is scoped to the JSX <main>
 * element(s) inside layout shells so the affordance rules in src/styles.css
 * (which target [data-radix-*] / .overflow-y-* wrappers) still work.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SHELL_FILES = ["src/components/layout/AppShell.tsx"];

const TRAP_PATTERNS = [
  /overflow-y-(?:auto|scroll)/,
  /overflow-(?:auto|scroll)\b/,
  /overscroll-(?:y-)?(?:contain|none)/,
  /\btouch-action\s*:\s*(?:pan-y|none|manipulation)/,
  /\[touch-action:(?:pan-y|none|manipulation)\]/,
  /overscrollBehaviorY\s*:\s*['"](?:contain|none)/,
  /touchAction\s*:\s*['"](?:pan-y|none|manipulation)/,
];

let failures = 0;
for (const rel of SHELL_FILES) {
  const abs = resolve(process.cwd(), rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  // Extract every JSX <main ...> opening tag (including multiline attrs).
  const mainTags = src.match(/<main\b[^>]*>/gs) ?? [];
  if (mainTags.length === 0) {
    console.log(`ℹ  ${rel}: no <main> element`);
    continue;
  }
  for (const tag of mainTags) {
    for (const pat of TRAP_PATTERNS) {
      if (pat.test(tag)) {
        failures += 1;
        console.error(
          `✗ ${rel}: <main> re-introduced scroll-trap style matching ${pat}\n  tag: ${tag.replace(/\s+/g, " ")}`,
        );
      }
    }
  }
  if (failures === 0) console.log(`✓ ${rel}: <main> is scroll-neutral`);
}

if (failures > 0) {
  console.error(
    `\n${failures} scroll-trap violation(s) — remove overflow-y-*, overscroll-*, ` +
      `and explicit touch-action from <main>. The document should be the scroller.`,
  );
  process.exit(1);
}
console.log("\n✓ no <main> scroll traps detected");
