import { describe, expect, it, vi } from "vitest";

vi.mock("./sports-guide.server", () => ({ sendTelegramText: async () => true }));

import { freeClaimAllowed, keyRow, newKey, revokeKey } from "./copier-keys";
import { claimFreeToken } from "./copier-keys.server";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const USER = "33333333-3333-3333-3333-333333333333";

/** Key rows, the token store item and a profile. */
function fakeDb(item: Record<string, unknown>) {
  const rows = new Map<string, string>();
  const from = (table: string) => {
    const f: { eq?: unknown; like?: string } = {};
    const q = {
      select: () => q,
      limit: () => q,
      eq: (_c: string, v: unknown) => ((f.eq = v), q),
      like: (_c: string, p: string) => ((f.like = p.replace(/%$/, "")), q),
      maybeSingle: async () => {
        if (table === "store_items") return { data: item };
        if (table === "profiles") return { data: { display_name: "sam" } };
        const v = rows.get(String(f.eq));
        return { data: v == null ? null : { value: v } };
      },
      upsert: async (r: { key: string; value: string }) => (
        rows.set(r.key, r.value),
        { error: null }
      ),
      insert: () => Promise.resolve({}),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: [...rows.entries()]
            .filter(([k]) => (f.like ? k.startsWith(f.like) : true))
            .map(([key, value]) => ({ key, value })),
        }),
    };
    return q;
  };
  return { db: { from }, rows };
}

const FREE = { price_cents: 0, coin_price: null, perk_slug: "signal_token", active: true };

describe("the OG SIGNAL BOT TOKEN while it's free", () => {
  it("one claim per token: again only when 3 days or fewer are left, never when switched off", () => {
    expect(freeClaimAllowed(null, NOW)).toEqual({ ok: true });
    const k = newKey("a".repeat(64), "Sam", 30, NOW);
    expect(freeClaimAllowed(k, NOW)).toEqual({ ok: false, reason: "has_time" });
    expect(freeClaimAllowed(k, NOW + 27 * 86_400_000)).toEqual({ ok: true });
    expect(freeClaimAllowed(revokeKey(k), NOW)).toEqual({ ok: false, reason: "off" });
  });

  it("claims 30 days onto the account while the item is free, and not twice", async () => {
    const { db, rows } = fakeDb(FREE);
    const a = await claimFreeToken(db, USER);
    expect(a.ok).toBe(true);
    expect(a.message).toMatch(/30 days/);
    expect(rows.size).toBe(1);
    const b = await claimFreeToken(db, USER);
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/already have your token/);
  });

  it("refuses once the Boss puts a price on it, or it's switched off in the store", async () => {
    expect((await claimFreeToken(fakeDb({ ...FREE, price_cents: 2999 }).db, USER)).ok).toBe(false);
    expect((await claimFreeToken(fakeDb({ ...FREE, active: false }).db, USER)).ok).toBe(false);
    expect((await claimFreeToken(fakeDb({ ...FREE, coin_price: 10 }).db, USER)).ok).toBe(false);
  });

  it("a switched-off token can't be claimed back for free", async () => {
    const { db, rows } = fakeDb(FREE);
    const k = { ...revokeKey(newKey("b".repeat(64), "Sam", 1, NOW)), userId: USER };
    rows.set(keyRow("b".repeat(64)), JSON.stringify(k));
    const r = await claimFreeToken(db, USER);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/switched off/);
  });
});
