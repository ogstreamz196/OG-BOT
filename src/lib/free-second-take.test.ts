import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("two tracks for one unlock", () => {
  it("does not offer or auto-charge a paid second track during creation", () => {
    const wizard = read("src/components/library/CreateNowWizard.tsx");
    const library = read("src/routes/_authenticated/library.index.lazy.tsx");
    expect(wizard).not.toContain("Want a second version too?");
    expect(wizard).not.toContain("wantSecondVersion");
    expect(library).not.toContain('invoke("reveal-variation"');
  });
  it("shows the free bonus for owners without promising it to community buyers", () => {
    expect(read("src/components/library/UnlockConfirmDialog.tsx")).toContain("2 tracks for the price of 1");
    expect(read("src/components/library/UnlockConfirmDialog.tsx")).toContain("includesSecondTake = false");
    expect(read("src/components/library/OwnerUnlockDialog.tsx")).toContain("includesSecondTake");
  });
  it("keeps charges atomic and bonus entitlements service-only", () => {
    const sql = read("drizzle/migrations/0003_free_second_take_unlock.sql");
    expect(sql).toContain("public.deduct_coins(p_user,price");
    expect(sql).toContain("AFTER INSERT ON public.unlocked_songs");
    expect(sql).toContain("AFTER INSERT ON public.songs");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
    expect(read("src/lib/track-unlock.functions.ts")).toContain(".middleware([requireSupabaseAuth])");
  });
});