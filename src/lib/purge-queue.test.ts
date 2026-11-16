import { describe, expect, it, vi } from "vitest";

vi.mock("./copy-settings-bot.server", () => ({
  isBossChat: async (_a: unknown, id: number) => ({ ok: id === 1, userId: "boss" }),
}));
vi.mock("./paper-account.server", () => ({
  paperState: async () => ({ start: 500, startedAt: "2026-11-15T10:46:53.169Z" }),
  paperBalance: async () => 612,
}));
const fresh: number[] = [];
vi.mock("./signals-fresh-start.server", () => ({
  freshStart: async (_a: unknown, b: number) => (fresh.push(b), { ok: true, swept: 1900 }),
}));
const edits: Record<string, unknown>[] = [];
vi.mock("./telegram-fleet.server", () => ({
  fleetApi: async (_id: string, _m: string, body: Record<string, unknown>) => (
    edits.push(body),
    { ok: true }
  ),
}));

import { dueJob, PURGE_JOB_KEY, resetTap, runQueuedPurge } from "./purge-bot.server";

function fakeDb() {
  const rows: Record<string, string> = {};
  const audit: unknown[] = [];
  return {
    rows,
    audit,
    db: {
      from: (t: string) => ({
        select: () => ({
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => ({ data: k in rows ? { value: rows[k] } : null }),
          }),
        }),
        upsert: async (r: { key: string; value: string }) => ((rows[r.key] = r.value), {}),
        insert: (r: unknown) => (t === "boss_audit_log" && audit.push(r), Promise.resolve({})),
      }),
    },
  };
}

describe("purge & reset is queued, then run by the watch", () => {
  it("Yes queues the purge (nothing runs inside the tap) and the watch runs it once", async () => {
    process.env.TELEGRAM_CREDENTIAL_KEY = "k";
    fresh.length = 0;
    edits.length = 0;
    const { db, rows, audit } = fakeDb();
    const card = { botId: "b", chatId: 1, messageId: 9 };
    const out = await resetTap(db, 1, "rs:go:500", card);
    expect(fresh).toEqual([]);
    expect(out.panel?.text).toMatch(/within a minute/);
    expect(JSON.parse(rows[PURGE_JOB_KEY])).toMatchObject({ balance: 500, state: "queued", card });
    expect(await runQueuedPurge(db)).toBe("purged at 500");
    expect(fresh).toEqual([500]);
    expect(JSON.parse(rows[PURGE_JOB_KEY]).state).toBe("done");
    expect(audit).toHaveLength(1);
    expect(String(edits.at(-1)?.text)).toMatch(/✅ Done/);
    expect(await runQueuedPurge(db)).toBe("none");
    expect(fresh).toEqual([500]);
  });

  it("not the Boss: nothing queued", async () => {
    const { db, rows } = fakeDb();
    expect((await resetTap(db, 2, "rs:go:500")).panel).toBeNull();
    expect(rows[PURGE_JOB_KEY]).toBeUndefined();
  });

  it("a stale, finished or broken job isn't run", () => {
    const now = Date.parse("2026-11-16T17:00:00Z");
    const job = (o: object) =>
      JSON.stringify({ balance: 500, state: "queued", at: "2026-11-16T16:59:00Z", ...o });
    expect(dueJob(job({}), now)?.balance).toBe(500);
    expect(dueJob(job({ at: "2026-11-16T16:40:00Z" }), now)).toBeNull();
    expect(dueJob(job({ state: "done" }), now)).toBeNull();
    expect(dueJob(job({ balance: 5 }), now)).toBeNull();
    expect(dueJob("{oops", now)).toBeNull();
    expect(dueJob(null, now)).toBeNull();
  });
});
