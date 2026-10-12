#!/usr/bin/env node
/**
 * Build-time route audit.
 * 1. Verifies every <Link to="/...">, <Navigate to="/...">, navigate({to:"/..."}),
 *    redirect({to:"/..."}) target resolves to a real route declared in
 *    src/routeTree.gen.ts (dynamic $params are matched structurally).
 * 2. Verifies every src/routes/_authenticated/admin*.tsx page renders an
 *    admin gate (useRole + Navigate when !isAdmin). The /_authenticated
 *    layout itself must enforce session redirect.
 * Exits non-zero on failure so CI breaks the build.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(root, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

// ---- 1. Known routes from generated tree -----------------------------------
const tree = readFileSync(join(SRC, "routeTree.gen.ts"), "utf8");
const knownPaths = new Set();
for (const m of tree.matchAll(/fullPath:\s*'([^']+)'/g)) {
  // normalise trailing slash variants ('/library/' === '/library')
  const raw = m[1];
  knownPaths.add(raw);
  if (raw.endsWith("/") && raw !== "/") knownPaths.add(raw.slice(0, -1));
}
// also add splat catch-alls (path = '/' covers root)
knownPaths.add("/");

function pathMatches(target) {
  if (knownPaths.has(target)) return true;
  // strip trailing slash
  if (target.endsWith("/") && knownPaths.has(target.slice(0, -1))) return true;
  // structural match for $params (e.g. /admin/users/$userId)
  for (const known of knownPaths) {
    if (!known.includes("$")) continue;
    const re = new RegExp("^" + known.replace(/\$[A-Za-z0-9_]+/g, "[^/]+") + "/?$");
    if (re.test(target)) return true;
  }
  return false;
}

// ---- 2. Collect navigation targets -----------------------------------------
const TARGET_RE =
  /(?:<(?:Link|Navigate)[^>]*?\bto=|(?:navigate|redirect)\s*\(\s*\{[^}]*?\bto:\s*)["'`](\/[A-Za-z0-9_$./-]*)["'`]/g;

const failures = [];
const files = walk(SRC).filter((f) => !f.endsWith("routeTree.gen.ts"));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(TARGET_RE)) {
    const target = m[1];
    if (!pathMatches(target)) {
      failures.push(`ORPHAN LINK  ${relative(root, file)} -> ${target}`);
    }
  }
}

// ---- 3. Admin guard audit --------------------------------------------------
const adminDir = join(SRC, "routes", "_authenticated");
const adminFiles = readdirSync(adminDir).filter((f) => /^admin[.\-]/.test(f) && f.endsWith(".tsx"));
for (const f of adminFiles) {
  const p = join(adminDir, f);
  const src = readFileSync(p, "utf8");
  // Accept any of:
  //  a) beforeLoad with redirect (route-level gate)
  //  b) useRole + a denial path triggered by !isAdmin (Navigate, Access denied, redirect)
  const beforeLoadGate = /beforeLoad[^]*?redirect\s*\(\s*\{\s*to:\s*["'`]\//.test(src);
  const hasUseRole = /useRole\s*\(/.test(src);
  const denialMatch =
    /!\s*[\w.]*isAdmin[^]{0,400}?(?:<Navigate\b|Access denied|throw\s+redirect)/.test(src);
  const hasGate = beforeLoadGate || (hasUseRole && denialMatch);
  if (!hasGate) {
    failures.push(
      `ADMIN UNGUARDED  ${relative(root, p)} (no beforeLoad redirect and no useRole + !isAdmin denial)`,
    );
  }
}

// ---- 4. Authenticated layout must enforce session --------------------------
const layout = readFileSync(join(adminDir, "route.tsx"), "utf8");
if (!/beforeLoad[^]*redirect\s*\(\s*\{\s*to:\s*["'`]\/(welcome|auth)["'`]/.test(layout)) {
  failures.push(
    "AUTH LAYOUT  src/routes/_authenticated/route.tsx missing beforeLoad redirect to /welcome|/auth",
  );
}

// ---- Report ---------------------------------------------------------------
if (failures.length) {
  console.error(
    `\n✗ Route audit failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):\n`,
  );
  for (const f of failures) console.error("  " + f);
  console.error("");
  process.exit(1);
}
console.log(
  `✓ Route audit passed — ${knownPaths.size} routes, ${adminFiles.length} admin pages guarded.`,
);
