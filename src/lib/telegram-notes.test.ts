import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { chat_id: number; text: string }[] = [];
vi.mock("./telegram-api.server", () => ({
  telegramApi: async (_m: string, body: { chat_id: number; text: string }) => {
    sent.push(body);
    return { ok: true, result: { message_id: sent.length } };
  },
}));

/** A tiny site_content + profiles stand-in. */
function fakeAdmin(value: string, changeBeforeClaim = false) {
  const store = { value };
  const profiles = [
    { email: "me@x.com", telegram_chat_id: 42 },
    { email: "nolink@x.com", telegram_chat_id: null },
  ];
  const q = (table: string) => {
    const f: Record<string, unknown> = {};
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => ((f[k] = v), api),
      in: (_k: string, v: string[]) => ((f.in = v), api),
      maybeSingle: async () => ({ data: { value: store.value } }),
      update: (u: { value: string }) => ((f.update = u), api),
      then: (res: (x: unknown) => void) => {
        if (table === "profiles")
          return res({ data: profiles.filter((p) => (f.in as string[]).includes(p.email)) });
        const u = f.update as { value: string } | undefined;
        if (changeBeforeClaim) return res({ data: [] });
        if (u && (f.value === undefined || f.value === store.value)) {
          store.value = u.value;
          return res({ data: [{ key: "telegram.notes" }] });
        }
        return res({ data: [] });
      },
    };
    return api;
  };
  return { admin: { from: q }, store };
}

describe("telegram notes", () => {
  beforeEach(() => (sent.length = 0));

  it("sends waiting notes in order, once, and marks them sent", async () => {
    const { sendTelegramNotes, parseNotes } = await import("./telegram-notes.server");
    const { admin, store } = fakeAdmin(
      JSON.stringify([
        { to: "Me@x.com", text: "Step 1" },
        { to: "me@x.com", text: "Step 2" },
        { to: "nolink@x.com", text: "Hi" },
      ]),
    );
    expect(await sendTelegramNotes(admin)).toBe("sent 2, skipped 1");
    expect(sent.map((s) => [s.chat_id, s.text])).toEqual([
      [42, "Step 1"],
      [42, "Step 2"],
    ]);
    const after = parseNotes(store.value);
    expect(after.slice(0, 2).every((n) => n.sentAt)).toBe(true);
    expect(after[2]).toMatchObject({ skipped: "no Telegram linked" });
    // Nothing left: the next run sends nothing again.
    expect(await sendTelegramNotes(admin)).toBe("none");
    expect(sent).toHaveLength(2);
  });

  it("never double-sends when another run claimed them first", async () => {
    const { sendTelegramNotes } = await import("./telegram-notes.server");
    const { admin } = fakeAdmin(JSON.stringify([{ to: "me@x.com", text: "x" }]), true);
    expect(await sendTelegramNotes(admin)).toBe("busy");
    expect(sent).toHaveLength(0);
  });

  it("junk or nothing queued is ignored", async () => {
    const { parseNotes } = await import("./telegram-notes.server");
    expect(parseNotes("not json")).toEqual([]);
    expect(parseNotes('[{"to":1}]')).toEqual([]);
    expect(parseNotes(null)).toEqual([]);
  });
});
