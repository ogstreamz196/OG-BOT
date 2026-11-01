import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readSongTicket, signSongTicket, songAudioUrl } from "./song-audio-link";
import * as deno from "../../supabase/functions/_shared/song-audio-link";

const SECRET = "test-service-role-key";
const NOW = 1_800_000_000;

describe("song audio tickets", () => {
  test("a genuine ticket reads back until it expires", async () => {
    const t = await signSongTicket(SECRET, { s: "song-1", e: NOW + 60, d: "My Track.mp3" });
    expect(await readSongTicket(SECRET, t, NOW)).toEqual({
      s: "song-1",
      e: NOW + 60,
      d: "My Track.mp3",
    });
    expect(await readSongTicket(SECRET, t, NOW + 61)).toBeNull();
  });

  test("tampered, wrong-key or junk tickets are refused", async () => {
    const t = await signSongTicket(SECRET, { s: "song-1", e: NOW + 60 });
    const [body, sig] = t.split(".");
    const other = await signSongTicket(SECRET, { s: "song-2", e: NOW + 60 });
    expect(await readSongTicket(SECRET, `${other.split(".")[0]}.${sig}`, NOW)).toBeNull();
    expect(await readSongTicket("another-key", t, NOW)).toBeNull();
    expect(await readSongTicket(SECRET, body, NOW)).toBeNull();
    expect(await readSongTicket(SECRET, "nonsense", NOW)).toBeNull();
  });

  test("the URL points at the stream route on the site", async () => {
    const url = await songAudioUrl(SECRET, "https://ogbot.co.uk/", "song-1", 300, undefined, NOW);
    expect(url).toMatch(/^https:\/\/ogbot\.co\.uk\/api\/public\/song-audio\?t=[\w-]+\.[\w-]+$/);
    const t = new URL(url).searchParams.get("t")!;
    expect((await readSongTicket(SECRET, t, NOW))?.s).toBe("song-1");
  });

  test("the player function's copy makes and reads the same tickets", async () => {
    const fromDeno = await deno.signSongTicket(SECRET, { s: "song-9", e: NOW + 60 });
    expect(await readSongTicket(SECRET, fromDeno, NOW)).toMatchObject({ s: "song-9" });
    const fromSite = await signSongTicket(SECRET, { s: "song-9", e: NOW + 60 });
    expect(fromDeno).toBe(fromSite);
    // And the code is the same, line for line, after the copy's header.
    const site = readFileSync(resolve(__dirname, "song-audio-link.ts"), "utf8");
    const copy = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/song-audio-link.ts"),
      "utf8",
    );
    expect(copy.endsWith(site)).toBe(true);
  });
});

describe("fullSongUrl", () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  });
  const admin = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://stored/${path}` },
        }),
      }),
    },
  };

  test("songs on Drive play from Drive; others from the stored file", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
    const { fullSongUrl } = await import("./song-audio.server");
    expect(
      await fullSongUrl(admin, { id: "a", audio_path: "a.mp3", drive_audio_id: "drive-a" }, 60),
    ).toMatch(/\/api\/public\/song-audio\?t=/);
    expect(
      await fullSongUrl(admin, { id: "b", audio_path: "b.mp3", drive_audio_id: null }, 60),
    ).toBe("https://stored/b.mp3");
    expect(await fullSongUrl(admin, { id: "c", audio_path: null }, 60)).toBeNull();
  });
});
