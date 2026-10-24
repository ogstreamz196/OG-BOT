import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards against accidentally rendering more than one
 * "Powered by OG Bot" / "MusicHUB · Powered by OG Bot" pill per
 * route file. We allow at most one header instance plus the
 * footer `<PoweredByOgBot />` component per route.
 */

const ROUTES_DIR = join(process.cwd(), "src/routes");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const PILL_PATTERNS = [
  /MusicHUB\s*[·•‧.|-]\s*Powered by OG B0T/gi,
  /Powered by OG B0T/gi,
  /<PoweredByOgBot\b/g,
];

describe("Powered by OG B0T pill uniqueness", () => {
  const files = walk(ROUTES_DIR).filter((f) => !f.endsWith(".gen.ts"));

  it.each(files)("%s renders the pill at most once", (file) => {
    const src = readFileSync(file, "utf8");
    const totals = PILL_PATTERNS.reduce((n, re) => n + (src.match(re)?.length ?? 0), 0);
    expect(
      totals,
      `${file} has ${totals} pill references — keep ≤ 1 per route`,
    ).toBeLessThanOrEqual(1);
  });
});
