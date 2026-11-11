import { beforeEach, describe, expect, it, vi } from "vitest";

const sendAudio = vi.fn(async (_m: string, _b: Record<string, unknown>) => ({ ok: true }));
vi.mock("@/lib/telegram-api.server", () => ({
  telegramApi: (m: string, b: Record<string, unknown>) => sendAudio(m, b),
  escapeTelegramHtml: (s: string) => s,
}));

import { sendTrackToTelegram } from "./telegram-track.server";

type Rows = {
  chat?: number | null;
  song?: Record<string, unknown> | null;
  unlock?: boolean;
  boss?: boolean;
};

function fakeAdmin(rows: Rows) {
  const result = (table: string) => {
    if (table === "profiles") return { data: { telegram_chat_id: rows.chat ?? null } };
    if (table === "songs") return { data: rows.song ?? null };
    if (table === "unlocked_songs") return { data: rows.unlock ? { id: "u" } : null };
    return { data: rows.boss ? [{ role: "boss" }] : [] };
  };
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) q[m] = () => q;
    q.in = () => Promise.resolve(result(table));
    q.maybeSingle = () => Promise.resolve(result(table));
    return q;
  };
  return {
    from: chain,
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "https://files.example/x.mp3" } }),
      }),
    },
  } as never;
}

const song = { id: "s1", user_id: "me", title: "Banger", audio_path: "a.mp3", status: "completed" };

describe("sendTrackToTelegram", () => {
  beforeEach(() => sendAudio.mockClear());

  it("needs a linked Telegram", async () => {
    expect(await sendTrackToTelegram(fakeAdmin({ song, unlock: true }), "u1", "s1")).toBe(
      "not_linked",
    );
  });
  it("needs the track unlocked (or Boss)", async () => {
    expect(await sendTrackToTelegram(fakeAdmin({ chat: 5, song }), "u2", "s1")).toBe("locked");
    expect(await sendTrackToTelegram(fakeAdmin({ chat: 5, song, boss: true }), "u3", "s1")).toBe(
      "sent",
    );
  });
  it("waits for the full file", async () => {
    const pending = { ...song, audio_path: null };
    expect(
      await sendTrackToTelegram(fakeAdmin({ chat: 5, song: pending, unlock: true }), "u4", "s1"),
    ).toBe("not_ready");
  });
  it("sends the MP3 to the member's own chat once per double tap", async () => {
    const admin = fakeAdmin({ chat: 77, song, unlock: true });
    expect(await sendTrackToTelegram(admin, "u5", "s1")).toBe("sent");
    expect(sendAudio).toHaveBeenCalledWith(
      "sendAudio",
      expect.objectContaining({
        chat_id: 77,
        audio: "https://files.example/x.mp3",
        title: "Banger",
      }),
    );
    expect(await sendTrackToTelegram(admin, "u5", "s1")).toBe("too_soon");
    expect(sendAudio).toHaveBeenCalledTimes(1);
  });
});
