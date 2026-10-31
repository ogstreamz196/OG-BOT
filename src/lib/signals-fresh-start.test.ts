import { describe, expect, it, vi } from "vitest";

// The fresh start: the chat swept, the record and the test account reset,
// then the Vantage invite and OG B0T's "money where my mouth is" post.

const calls: { method: string; body: Record<string, any> }[] = [];
vi.mock("./telegram-worker.server", () => ({
  workerApi: async (method: string, body: Record<string, any>) => {
    calls.push({ method, body });
    return method === "sendMessage"
      ? { ok: true, result: { message_id: 950 + calls.length } }
      : { ok: true };
  },
}));
// OG B0T can't post here in the test, so the trade bot posts its message.
vi.mock("./telegram-api.server", () => ({ telegramApi: async () => null }));
vi.mock("./signal-chat.server", () => ({
  signalsChatId: async () => -1001234,
  refreshScore: async () => "posted",
  PURGED_KEY: "signals.chat.purgedAt",
}));
vi.mock("./signal-record.server", () => ({
  resetSignalRecord: async () => "2026-10-31T12:00:00.000Z",
}));

import { freshStart } from "./signals-fresh-start.server";

function fakeAdmin() {
  const writes: { table: string; op: string; row?: unknown }[] = [];
  return {
    writes,
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        gt: () => q,
        limit: () => q,
        delete: () => (writes.push({ table, op: "delete" }), q),
        update: (row: unknown) => (writes.push({ table, op: "update", row }), q),
        upsert: async (row: unknown) => (
          writes.push({ table, op: "upsert", row }),
          { error: null }
        ),
        maybeSingle: async () => ({ data: { user_id: "boss" }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return q;
    },
  };
}

describe("freshStart", () => {
  it("sweeps the chat, resets everything and posts the two messages in order", async () => {
    const admin = fakeAdmin();
    const out = await freshStart(admin, 1000, Date.parse("2026-10-31T12:00:00Z"));
    expect(out).toMatchObject({
      ok: true,
      vantageMessage: true,
      testModeMessage: true,
      score: "posted",
    });
    const sweeps = calls.filter((c) => c.method === "deleteMessages");
    // From the marker (id 951) back: every id down to 1, 100 at a time.
    expect(sweeps[0].body.message_ids[0]).toBe(951);
    expect(sweeps.flatMap((c) => c.body.message_ids)).toContain(1);
    const posts = calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text);
    expect(posts[0]).toMatch(/Clearing the decks/);
    expect(posts[1]).toMatch(/Vantage/);
    expect(
      calls.find((c) => c.body.text === posts[1])!.body.reply_markup.inline_keyboard[0][0].url,
    ).toMatch(/^https:\/\//);
    expect(posts[2]).toMatch(/^💸 PUTTING MY MONEY WHERE MY MOUTH IS[\s\S]*\$1,000 demo/);
    expect(posts[2]).toMatch(/Counter from zero/);
    // The test account and Standard STP's zero commission are saved.
    const saved = admin.writes.filter((w) => w.op === "upsert").map((w) => (w.row as any).key);
    expect(saved).toEqual(
      expect.arrayContaining(["signals.paper", "mt5.commissionPerLot", "signals.chat.purgedAt"]),
    );
    // Nothing stored is deleted or changed: only settings are written.
    expect(admin.writes.filter((w) => w.op !== "upsert")).toEqual([]);
  });
});
