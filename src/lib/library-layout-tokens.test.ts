import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lock the Make a Track (Library) page's structural layout tokens.
 * A companion runtime check lives in scripts/library-layout-check.mjs.
 */
const SRC = readFileSync(
  join(__dirname, "..", "routes", "_authenticated", "library.index.lazy.tsx"),
  "utf8",
);

const REQUIRED: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "library-root is a flex column with gap-8",
    pattern: /data-testid="library-root"[\s\S]{0,300}?className="[^"]*\bflex\b[^"]*\bgap-8\b/,
  },
  {
    name: "studio console hero panel present",
    pattern: /data-testid="library-hero"[\s\S]{0,200}?studio-panel/,
  },
  {
    name: "Your Library header uses mb-4 + gap-3",
    pattern: /data-testid="library-your-header"[\s\S]{0,300}?\bmb-4\b[^"]*\bgap-3\b/,
  },
  {
    name: "library cards list uses space-y-2",
    pattern: /data-testid="library-cards"[\s\S]{0,160}?\bspace-y-2\b/,
  },
];

describe("library layout tokens", () => {
  for (const { name, pattern } of REQUIRED) {
    it(name, () => {
      expect(pattern.test(SRC), `Missing token rule: ${name}`).toBe(true);
    });
  }
});
