import { describe, expect, it, vi } from "vitest";

const sent: { chat: number; text: string }[] = [];
vi.mock("./sports-guide.server", () => ({
  sendTelegramText: async (chat: number, text: string) => (sent.push({ chat, text }), true),
}));

import {
  boughtKey,
  memberConfig,
  newKey,
  parseKey,
  revokeKey,
  TOKEN_ITEM_SLUG,
  tokenPerkDays,
  tokenPerkLabel,
} from "./copier-keys";
import { grantSignalToken, issueMyToken } from "./copier-keys.server";
import { storeItemAllowed } from "./native-policy";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const DAY = 86_400_000;
const USER = "8f8af169-4cc9-4294-8599-5728c527cea0";

/** Just enough of the database for the key rows, profiles and the audit log. */
function fakeDb(profile: Record<string, unknown> = {}) {
  const rows = new Map<string, string>();
  const audit: unknown[] = [];
  const from = (table: string) => {
    const f: { col?: string; val?: unknown; like?: string } = {};
    const q = {
      select: () => q,
      limit: () => q,
      eq: (col: string, val: unknown) => ((f.col = col), (f.val = val), q),
      like: (_c: string, pat: string) => ((f.like = pat.replace(/%$/, "")), q),
      maybeSingle: async () => {
        if (table === "profiles") return { data: profile };
        const v = rows.get(String(f.val));
        return { data: v == null ? null : { value: v } };
      },
      upsert: async (r: { key: string; value: string }) => (
        rows.set(r.key, r.value),
        { error: null }
      ),
      insert: (r: unknown) => (table === "boss_audit_log" && audit.push(r), Promise.resolve({})),
      delete: () => ({
        eq: async (_c: string, k: string) => (rows.delete(k), { error: null }),
      }),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: [...rows.entries()]
            .filter(([k]) => (f.like ? k.startsWith(f.like) : true))
            .map(([key, value]) => ({ key, value })),
        }),
    };
    return q;
  };
  return { db: { from }, rows, audit };
}

describe("OG SIGNAL BOT TOKEN", () => {
  it("reads the store perk: signal_token is 30 days, signal_token:90 is 90", () => {
    expect(tokenPerkDays("signal_token")).toBe(30);
    expect(tokenPerkDays("signal_token:90")).toBe(90);
    expect(tokenPerkDays("signal_token:0")).toBeNull();
    expect(tokenPerkDays("vault_pass")).toBeNull();
    expect(tokenPerkDays(null)).toBeNull();
    expect(tokenPerkLabel("signal_token:365")).toBe("365 days of OG SIGNAL BOT");
  });

  it("a first purchase makes a key tied to the account; buying again adds days and switches it back on", () => {
    const first = boughtKey(null, { hash: "a".repeat(64), name: "Fred", userId: USER }, 30, NOW);
    expect(first.userId).toBe(USER);
    expect(Date.parse(first.expiresAt)).toBe(NOW + 30 * DAY);
    const off = revokeKey({ ...first, stick: "disk-1", account: "123" });
    const again = boughtKey(off, { hash: "b".repeat(64), name: "x", userId: USER }, 30, NOW + DAY);
    expect(again.revoked).toBeUndefined();
    expect(Date.parse(again.expiresAt)).toBe(NOW + 60 * DAY);
    // The machine lock stays.
    expect(again.stick).toBe("disk-1");
    // An expired key restarts from now.
    const old = { ...newKey("c".repeat(64), "Old", 1, NOW - 10 * DAY) };
    expect(
      Date.parse(boughtKey(old, { hash: "", name: "", userId: USER }, 30, NOW).expiresAt),
    ).toBe(NOW + 30 * DAY);
  });

  it("the store webhook's grant makes, then extends, the buyer's key and tells them on Telegram", async () => {
    sent.length = 0;
    const { db, rows, audit } = fakeDb({ display_name: "fredtrader", telegram_chat_id: 555 });
    const a = await grantSignalToken(db, USER, 30, "stripe:live:store:cs_1");
    expect(a).toMatchObject({ ok: true, created: true });
    expect(rows.size).toBe(1);
    const key = parseKey([...rows.values()][0]);
    expect(key?.userId).toBe(USER);
    expect(key?.name).toBe("fredtrader");
    const b = await grantSignalToken(db, USER, 30, "stripe:live:store:cs_2");
    expect(b).toMatchObject({ ok: true, created: false });
    expect(rows.size).toBe(1);
    expect(Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!)).toBeGreaterThan(29 * DAY);
    expect(audit).toHaveLength(2);
    expect(sent).toHaveLength(2);
    expect(sent[0].chat).toBe(555);
    expect(sent[0].text).toMatch(/OG SIGNAL BOT TOKEN.*30 days/);
    expect(sent[0].text).toMatch(/ogbot\.co\.uk\/copier/);
  });

  it("the member's token is made fresh: the old row goes, the expiry carries over", async () => {
    const { db, rows } = fakeDb({ display_name: "fred" });
    expect(await issueMyToken(db, USER)).toBeNull();
    const granted = await grantSignalToken(db, USER, 30, "r");
    const before = [...rows.keys()][0];
    const t = await issueMyToken(db, USER);
    expect(t?.token).toMatch(/^ogk_/);
    expect(t?.expiresAt).toBe(granted.expiresAt);
    expect(rows.size).toBe(1);
    expect([...rows.keys()][0]).not.toBe(before);
    expect(memberConfig(t!.token)).toContain(`token = ${t!.token}`);
    expect(memberConfig("x")).toContain("dry_run = false");
  });

  it("is never sold in the phone apps", () => {
    expect(storeItemAllowed(TOKEN_ITEM_SLUG, true)).toBe(false);
    expect(storeItemAllowed(TOKEN_ITEM_SLUG, false)).toBe(true);
  });
});
