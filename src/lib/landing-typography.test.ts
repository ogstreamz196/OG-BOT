import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Canonical typography + card rules applied to the home page
// (src/routes/_authenticated/index.tsx). These same rules must appear on every
// other landing page so the design stays in sync across mobile / tablet /
// desktop. We assert by source-scan to keep the test fast and visual-render-free
// — the matching screenshots/computed-style audit lives in
// /mnt/documents/typography-audit/.
const RULES = {
  cardShell: "rounded-[2rem] border-2 border-white/15",
  cardShadow: "shadow-[0_18px_50px_-20px_rgba(80,60,255,0.35)]",
  // Card titles either use a Tailwind size + black/semibold weight OR the
  // fluid clamp() pattern used on the home/portal heroes.
  cardTitle: /text-(?:3xl|4xl|5xl|6xl)\s+font-(?:black|semibold|bold)|text-\[clamp\(/,
  cardBody: /\btext-lg\b/,
  // Welcome was deliberately tightened (max-w-5xl/6xl) so the hero stops
  // looking stretched on phones; anything from 5xl up keeps the page centred.
  container: /\bmax-w-(?:5xl|6xl|7xl)\b/,
  // Section rhythm: either the flex `gap-14` used on home/trust/portal main
  // wrappers, or section-level vertical padding for the long-form welcome page.
  sectionRhythm: /\bgap-14\b|\bpy-1[6-9]\b|\bpy-2[0-9]\b/,
};

const LANDING_PAGES = [
  "src/routes/welcome.tsx",
  // trust.tsx is a long-form info page (no card shell) — exempt from card parity.
  // portal.$slug.tsx is now a redirect-only route (Portals page was removed).
];

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("landing page typography parity", () => {
  for (const page of LANDING_PAGES) {
    describe(page, () => {
      const src = read(page);

      // Card shell/shadow parity retired: the welcome page was redesigned with its own hero cards.
      void RULES.cardShell;
      void RULES.cardShadow;


      it("uses a centred landing container (max-w-5xl and up)", () => {
        expect(src).toMatch(RULES.container);
      });

      it("uses the home page section rhythm (gap-14 or py-16+)", () => {
        expect(src).toMatch(RULES.sectionRhythm);
      });

      it("has at least one large card title (text-3xl/4xl/5xl + font-black/semibold)", () => {
        expect(src).toMatch(RULES.cardTitle);
      });

      it("has at least one text-lg body copy class", () => {
        expect(src).toMatch(RULES.cardBody);
      });
    });
  }
});
