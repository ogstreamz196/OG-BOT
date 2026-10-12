import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Accessibility & wording audit for the shared <Switch /> primitive and any
// site-wide toggle controls. We assert by source-scan so the test stays fast
// and visual-render-free. The contract:
//   1. <Switch /> wraps Radix's SwitchPrimitives.Root, which auto-applies
//      role="switch" + aria-checked. The wrapper must NOT remove the spread
//      that forwards aria-label / aria-labelledby from call sites.
//   2. The visible track shows "Turn on" when unchecked and "Turn off" when
//      checked — clearly describing what the next click will do.
//   3. A screen-reader-only span complements aria-checked with a plain-English
//      state announcement so non-sighted users get the same clarity.
//   4. No site-wide toggle UI still uses ambiguous "Enable" / "Disable" wording
//      in user-facing aria-labels.

const ROOT = join(__dirname, "..", "..");

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Switch accessibility contract", () => {
  const src = read("src/components/ui/switch.tsx");

  it("forwards all props (including aria-*) to Radix Root", () => {
    expect(src).toMatch(/\{\.\.\.props\}/);
  });

  it('renders Off label for the unchecked state', () => {
    expect(src).toMatch(/group-data-\[state=checked\]:hidden[^>]*>\s*Off/);
  });

  it('renders On label for the checked state', () => {
    expect(src).toMatch(/group-data-\[state=unchecked\]:hidden[^>]*>\s*On/);
  });

  it("includes an sr-only state announcement for screen readers", () => {
    expect(src).toMatch(/sr-only/);
    expect(src).toMatch(/Currently off/);
    expect(src).toMatch(/Currently on/);
  });

  it("decorates the visible label as aria-hidden so SR users only hear the sr-only copy + aria-checked", () => {
    expect(src).toMatch(/aria-hidden="true"/);
  });
});

describe("site-wide toggle wording", () => {
  it("HighContrastToggle uses 'Turn on/Turn off' wording, not 'Enable/Disable'", () => {
    const src = read("src/components/layout/HighContrastToggle.tsx");
    expect(src).toMatch(/Turn off high contrast/);
    expect(src).toMatch(/Turn on high contrast/);
    expect(src).not.toMatch(/aria-label=\{[^}]*Disable high contrast/);
    expect(src).not.toMatch(/aria-label=\{[^}]*Enable high contrast/);
  });
});
