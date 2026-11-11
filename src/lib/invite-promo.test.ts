import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { method: string; body: Record<string, unknown> }[] = [];
vi.mock("./telegram-worker.server", () => ({
  managedGroup: async () => ({ chat_type: "supergroup", og_bot_present: true }),
  workerApi: async (method: string, body: Record<string, unknown>) => {
    sent.push({ method, body });
    return { ok: true, result: { message_id: 900 + sent.length } };
  },
}));
vi.mock("./signal-broadcast.server", () => ({ signalsChannelReady: () => true }));
vi.mock("./signal-chat.server", () => ({ signalsChatId: async () => -100123 }));

import { INVITE_LINK, maybePostPromo, promoDue } from "./invite-promo.server";

// Wednesday 28 Oct 2026, 14:00 UK (GMT).
const AFTERNOON = Date.UTC(2026, 9, 28, 14);

function fakeAdmin(settings: Record<string, string>) {
  return {
    from: () => {
      let key = "";
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (_c: string, v: string) => ((key = v), q);
      q.maybeSingle = async () => ({ data: key in settings ? { value: settings[key] } : null });
      q.upsert = async (row: { key: string; value: string }) => {
        settings[row.key] = row.value;
        return { error: null };
      };
      return q;
    },
  } as never;
}

beforeEach(() => {
  sent.length = 0;
});

describe("promoDue", () => {
  it("every 8 hours at most, UK daytime only", () => {
    expect(promoDue(null, AFTERNOON)).toBe(true);
    expect(promoDue(new Date(AFTERNOON - 7 * 3600_000).toISOString(), AFTERNOON)).toBe(false);
    expect(promoDue(new Date(AFTERNOON - 8 * 3600_000).toISOString(), AFTERNOON)).toBe(true);
    expect(promoDue(null, Date.UTC(2026, 9, 28, 23))).toBe(false);
    expect(promoDue(null, Date.UTC(2026, 9, 28, 7))).toBe(false);
  });
});

describe("maybePostPromo", () => {
  it("posts silently with the invite button and replaces the last promo", async () => {
    const settings: Record<string, string> = { "promo.invite.lastMessage": "777" };
    expect(await maybePostPromo(fakeAdmin(settings), AFTERNOON)).toBe("posted");
    const post = sent.find((s) => s.method === "sendMessage")!;
    expect(post.body).toMatchObject({ chat_id: -100123, disable_notification: true });
    expect(JSON.stringify(post.body.reply_markup)).toContain(INVITE_LINK);
    expect(sent.find((s) => s.method === "deleteMessage")!.body).toEqual({
      chat_id: -100123,
      message_id: 777,
    });
    expect(settings["promo.invite.lastMessage"]).toBe("901");
    // Straight after: not due again.
    expect(await maybePostPromo(fakeAdmin(settings), AFTERNOON + 60_000)).toBe("not due");
  });
});
