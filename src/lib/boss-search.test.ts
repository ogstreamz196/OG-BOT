import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { BOSS_SETTINGS, memberMatches, searchSettings } from "./boss-search";

// "/admin/music" lives in routes/_authenticated/admin.music.tsx.
const routeFile = (to: string) =>
  resolve(__dirname, "../routes/_authenticated", `${to.slice(1).replace(/\//g, ".")}.tsx`);

describe("Boss search registry", () => {
  test("every tab it links to exists on that page", () => {
    for (const s of BOSS_SETTINGS.filter((x) => x.tab)) {
      const src = readFileSync(routeFile(s.to), "utf8");
      expect(src, `${s.title} → ${s.to}?tab=${s.tab}`).toContain(`value: "${s.tab}"`);
    }
  });

  test("every Settings section it links to exists", () => {
    const src = readFileSync(routeFile("/settings"), "utf8");
    for (const s of BOSS_SETTINGS.filter((x) => x.hash)) {
      expect(src).toContain(`id: "${s.hash}"`);
    }
  });
});

describe("searchSettings", () => {
  test("finds switches by what they do, title hits first", () => {
    expect(searchSettings("free access")[0].title).toBe("Free access for everyone");
    expect(searchSettings("mt5")[0].tab).toBe("signals");
    expect(searchSettings("foul")[0].to).toBe("/settings");
    expect(searchSettings("stripe")[0].tab).toBe("webhooks");
  });

  test("every word has to match, and an empty box finds nothing", () => {
    expect(searchSettings("telegram zebra")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });
});

describe("memberMatches", () => {
  const m = {
    id: "abc12345-0000",
    email: "dan@example.com",
    display_name: "Big Dan",
    telegram_username: "bigdan",
    og_vip_id: "OG-1234",
  };

  test("matches name, email, Telegram (with or without @), VIP ID and id start", () => {
    for (const q of ["big", "EXAMPLE", "@bigdan", "og-12", "abc1"]) {
      expect(memberMatches(m, q), q).toBe(true);
    }
    expect(memberMatches(m, "0000")).toBe(false);
  });
});
