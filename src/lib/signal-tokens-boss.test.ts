import { describe, expect, it, vi } from "vitest";

vi.mock("./sports-guide.server", () => ({ sendTelegramText: async () => true }));

import { keyRow, newKey, parseKey } from "./copier-keys";
import { bossKeyAction, bossKeyRows, bossPairAccount } from "./copier-keys.server";

const DAY = 86_400_000;
const FRED = "11111111-1111-1111-1111-111111111111";
const ANNA = "22222222-2222-2222-2222-222222222222";
const PROFILES = [
  { id: FRED, display_name: "fred", email: "fred@example.com" },
  { id: ANNA, display_name: "anna", email: "anna@example.com" },
];

/** Key rows in site_content, the profiles above, and the audit log. */
function fakeDb() {
  const rows = new Map<string, string>();
  const audit: { target_key: string }[] = [];
  const from = (table: string) => {
    const f: { eq?: [string, unknown]; like?: string; ilike?: [string, string]; ids?: string[] } =
      {};
    const profileRows = () =>
      PROFILES.filter((p) =>
        f.ids
          ? f.ids.includes(p.id)
          : f.ilike
            ? String(p[f.ilike[0] as "email"]).toLowerCase() === f.ilike[1].toLowerCase()
            : f.eq
              ? p.id === f.eq[1]
              : true,
      );
    const q = {
      select: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => ((f.eq = [c, v]), q),
      in: (_c: string, ids: string[]) => ((f.ids = ids), q),
      like: (_c: string, pat: string) => ((f.like = pat.replace(/%$/, "")), q),
      ilike: (c: string, v: string) => ((f.ilike = [c, v]), q),
      maybeSingle: async () => {
        if (table === "profiles") return { data: profileRows()[0] ?? null };
        const v = rows.get(String(f.eq?.[1]));
        return { data: v == null ? null : { value: v } };
      },
      upsert: async (r: { key: string; value: string }) => (
        rows.set(r.key, r.value),
        { error: null }
      ),
      insert: (r: { target_key: string }) => (
        table === "boss_audit_log" && audit.push(r),
        Promise.resolve({})
      ),
      delete: () => ({ eq: async (_c: string, k: string) => (rows.delete(k), { error: null }) }),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data:
            table === "profiles"
              ? profileRows()
              : [...rows.entries()]
                  .filter(([k]) => (f.like ? k.startsWith(f.like) : true))
                  .map(([key, value]) => ({ key, value })),
        }),
    };
    return q;
  };
  return { db: { from }, rows, audit };
}

const hash = (c: string) => c.repeat(64);
const keyOf = (rows: Map<string, string>, h: string) => parseKey(rows.get(keyRow(h)));

describe("the Control Room's OG SIGNAL BOT tokens", () => {
  it("lists every key with its paired account, soonest to run out first", async () => {
    const { db, rows } = fakeDb();
    const now = Date.now();
    rows.set(
      keyRow(hash("a")),
      JSON.stringify({ ...newKey(hash("a"), "Fred", 30, now), userId: FRED }),
    );
    rows.set(keyRow(hash("b")), JSON.stringify(newKey(hash("b"), "Walk-in", 5, now)));
    const list = await bossKeyRows(db);
    expect(list.map((r) => r.name)).toEqual(["Walk-in", "Fred"]);
    expect(list[1].account).toEqual({ userId: FRED, label: "fred" });
    expect(list[0].account).toBeNull();
    expect(list[0].state).toBe("active");
  });

  it("adds days, switches off and on, clears the lock and removes, each audit-logged", async () => {
    const { db, rows, audit } = fakeDb();
    const now = Date.now();
    const k = { ...newKey(hash("a"), "Fred", 10, now), stick: "disk-1", account: "123" };
    rows.set(keyRow(hash("a")), JSON.stringify(k));
    expect((await bossKeyAction(db, FRED, k.id, "extend", 30)).ok).toBe(true);
    expect(Date.parse(keyOf(rows, hash("a"))!.expiresAt) - now).toBeGreaterThan(39 * DAY);
    await bossKeyAction(db, FRED, k.id, "off");
    expect(keyOf(rows, hash("a"))!.revoked).toBe(true);
    await bossKeyAction(db, FRED, k.id, "on");
    expect(keyOf(rows, hash("a"))!.revoked).toBeUndefined();
    await bossKeyAction(db, FRED, k.id, "reset");
    expect(keyOf(rows, hash("a"))!.stick).toBeUndefined();
    expect((await bossKeyAction(db, FRED, k.id, "remove")).ok).toBe(true);
    expect(rows.size).toBe(0);
    expect(audit).toHaveLength(5);
    expect((await bossKeyAction(db, FRED, k.id, "on")).message).toMatch(/gone/);
  });

  it("gives days to an account by email or username, on a new key or the one they have", async () => {
    const { db, rows } = fakeDb();
    const a = await bossPairAccount(db, FRED, "anna@example.com", { days: 90 });
    expect(a.ok).toBe(true);
    expect(a.message).toMatch(/90 days on a new token for anna/);
    const b = await bossPairAccount(db, FRED, "ANNA", { days: 30 });
    expect(b.message).toMatch(/30 days added for anna/);
    expect(rows.size).toBe(1);
    expect((await bossPairAccount(db, FRED, "nobody", { days: 30 })).ok).toBe(false);
  });

  it("pairs a token made in Telegram with an account, never one that's taken", async () => {
    const { db, rows } = fakeDb();
    const now = Date.now();
    const loose = newKey(hash("c"), "Walk-in", 30, now);
    rows.set(keyRow(hash("c")), JSON.stringify(loose));
    const ok = await bossPairAccount(db, FRED, "fred", { keyId: loose.id });
    expect(ok.ok).toBe(true);
    expect(keyOf(rows, hash("c"))!.userId).toBe(FRED);
    // Already paired with Fred: Anna can't take it.
    expect((await bossPairAccount(db, FRED, "anna", { keyId: loose.id })).ok).toBe(false);
    // Anna has her own: a second loose key can't be paired to her too.
    await bossPairAccount(db, FRED, "anna", { days: 30 });
    const loose2 = newKey(hash("d"), "Another", 30, now);
    rows.set(keyRow(hash("d")), JSON.stringify(loose2));
    const no = await bossPairAccount(db, FRED, "anna", { keyId: loose2.id });
    expect(no.ok).toBe(false);
    expect(no.message).toMatch(/already has a token/);
  });
});
