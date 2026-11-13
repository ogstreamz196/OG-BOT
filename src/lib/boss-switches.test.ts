import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { BOSS_SWITCHES, SWITCH_AREAS } from "./boss-switches";

const routeFile = (to: string) =>
  resolve(
    __dirname,
    "../routes/_authenticated",
    `${to === "/admin" ? "admin.index" : to.slice(1).replace(/\//g, ".")}.tsx`,
  );

describe("Every switch list", () => {
  test("every link lands on a real tab or Settings section", () => {
    for (const s of BOSS_SWITCHES) {
      if (s.tab) {
        const src = readFileSync(routeFile(s.to!), "utf8");
        expect(src, `${s.name} → ${s.to}?tab=${s.tab}`).toContain(`value: "${s.tab}"`);
      }
      if (s.hash) {
        const src = readFileSync(routeFile("/settings"), "utf8");
        expect(src, `${s.name} → #${s.hash}`).toContain(`id: "${s.hash}"`);
      }
    }
  });

  test("each switch says what on and off do, and either links somewhere or is Telegram-only", () => {
    for (const s of BOSS_SWITCHES) {
      expect(s.on.length, s.name).toBeGreaterThan(10);
      expect(s.off.length, s.name).toBeGreaterThan(10);
      expect(!!s.to !== !!s.telegramOnly, s.name).toBe(true);
      expect(SWITCH_AREAS).toContain(s.area);
    }
  });

  test("names are unique", () => {
    const names = BOSS_SWITCHES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
