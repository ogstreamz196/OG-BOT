import { describe, expect, test } from "vitest";
import {
  CONNECT_TOKEN_RE,
  CONNECT_TTL_MS,
  claimConnectToken,
  createConnectToken,
} from "./telegram-connect.server";

type Row = Record<string, unknown>;

/** Just enough of the database client for connect tokens and profiles. */
function fakeDb(profiles: Row[]) {
  const tables: Record<string, Row[]> = { telegram_connect_tokens: [], profiles };
  const from = (table: string) => {
    const rows = tables[table];
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let single = false;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      maybeSingle: () => ((single = true), q),
      insert: (row: Row) => {
        rows.push({ id: `t${rows.length}`, used_at: null, ...row });
        return Promise.resolve({ error: null });
      },
      update: (p: Row) => ((patch = p), q),
      then: (resolve: (v: unknown) => void) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        resolve({ data: single ? (hit[0] ?? null) : hit, error: null });
      },
    };
    return q;
  };
  return { db: { from }, tables };
}

const DAVE = { id: 9001, username: "dave", first_name: "Dave" };

describe("telegram connect links", () => {
  test("a link ties that Telegram to whoever signs in through it, once", async () => {
    const { db, tables } = fakeDb([{ id: "me", telegram_chat_id: null }]);
    const token = (await createConnectToken(db, DAVE))!;
    expect(token).toMatch(CONNECT_TOKEN_RE);
    // Only a hash is stored, never the token itself.
    expect(JSON.stringify(tables.telegram_connect_tokens)).not.toContain(token);

    expect(await claimConnectToken(db, "me", token)).toEqual({ ok: true, telegramUserId: 9001 });
    expect(tables.profiles[0]).toMatchObject({ telegram_chat_id: 9001, telegram_username: "dave" });
    expect(await claimConnectToken(db, "someone-else", token)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  test("expired, made-up and malformed links are refused", async () => {
    const { db, tables } = fakeDb([{ id: "me", telegram_chat_id: null }]);
    const now = Date.now();
    const token = (await createConnectToken(db, DAVE, now))!;
    expect(await claimConnectToken(db, "me", token, now + CONNECT_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await claimConnectToken(db, "me", `tc_${"A".repeat(43)}`)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await claimConnectToken(db, "me", "t_abc")).toEqual({ ok: false, reason: "invalid" });
    expect(tables.profiles[0].telegram_chat_id).toBeNull();
  });

  test("a Telegram linked to an older account moves to the new one", async () => {
    const { db, tables } = fakeDb([
      { id: "old", telegram_chat_id: 9001, telegram_username: "dave" },
      { id: "me", telegram_chat_id: null },
    ]);
    const token = (await createConnectToken(db, DAVE))!;
    expect((await claimConnectToken(db, "me", token)).ok).toBe(true);
    expect(tables.profiles.find((p) => p.id === "old")!.telegram_chat_id).toBeNull();
    expect(tables.profiles.find((p) => p.id === "me")!.telegram_chat_id).toBe(9001);
  });
});
