import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractVocalUrl,
  isPaidNasheed,
  requestVocalSeparation,
  vocalRemovalFailed,
} from "../../supabase/functions/_shared/nasheed-stems";
import { materialiseClips as edgeMaterialise } from "../../supabase/functions/_shared/suno-materialise";
import { materialiseClips as appMaterialise } from "./suno-recover.server";

/** Minimal in-memory stand-in for the database client the pipeline uses. */
function fakeDb(rows: Record<string, Record<string, any>>, unlocked: string[] = []) {
  const uploads: string[] = [];
  const db = {
    uploads,
    rows,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          if (patch && table === "songs" && k === "id") Object.assign(rows[String(v)], patch);
          return q;
        },
        update: (p: Record<string, unknown>) => ((patch = p), q),
        insert: (row: Record<string, unknown>) => {
          const id = `sib-${Object.keys(rows).length}`;
          rows[id] = { id, ...row };
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        },
        maybeSingle: async () => {
          if (table === "unlocked_songs") {
            return { data: unlocked.includes(String(filters.song_id)) ? { id: "u" } : null };
          }
          if (table === "songs" && filters.suno_clip_id) {
            const hit = Object.values(rows).find((r) => r.suno_clip_id === filters.suno_clip_id);
            return { data: hit ? { id: hit.id } : null };
          }
          if (table === "app_settings") return { data: null };
          return { data: null };
        },
        then: (r: (v: unknown) => void) => r({ data: null, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  };
  return db;
}

const baseSong = () => ({
  id: "song-1",
  user_id: "user-1",
  title: "Light Upon Light",
  status: "pending",
  is_nasheed: true,
  unlocked: true,
  suno_task_id: "task-1",
  cover_url: "https://cdn1.suno.ai/cover.jpg",
  duration_seconds: 200,
});

const take = (id: string) => ({
  audioUrl: `https://cdn1.suno.ai/${id}.mp3`,
  clipId: id,
  coverUrl: "https://cdn1.suno.ai/c.jpg",
  title: "Light Upon Light",
  duration: 200,
});

const mp3 = () => new Response(new Uint8Array(2048), { status: 200 });

let calls: { url: string; body: any }[] = [];
beforeEach(() => {
  calls = [];
});
const realFetch = globalThis.fetch;
/** Swaps in a fake fetch (works under both Vitest and Bun's test runner). */
function stubFetch(fn: unknown) {
  globalThis.fetch = fn as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubEngine(opts: { separate?: any; record?: any } = {}) {
  stubFetch(
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("vocal-removal/generate")) {
        return new Response(
          JSON.stringify(opts.separate ?? { code: 200, data: { taskId: "stem-1" } }),
        );
      }
      if (url.includes("vocal-removal/record-info")) {
        return new Response(
          JSON.stringify(opts.record ?? { code: 200, data: { successFlag: "PENDING" } }),
        );
      }
      return mp3();
    }),
  );
}

describe("vocal separation helpers", () => {
  it("finds the vocal file in every callback/record shape", () => {
    const u = "https://tempfile.aiquickdraw.com/v.mp3";
    expect(
      extractVocalUrl({ data: { vocal_removal_info: { vocal_url: u, instrumental_url: "x" } } }),
    ).toBe(u);
    expect(extractVocalUrl({ data: { response: { vocalUrl: u } } })).toBe(u);
    expect(extractVocalUrl({ data: { vocal_audio_url: u } })).toBe(u);
    expect(extractVocalUrl({ data: { instrumental_url: "https://a/b.mp3" } })).toBeNull();
  });

  it("spots a failed separation", () => {
    expect(vocalRemovalFailed({ code: 500 })).toBe(true);
    expect(vocalRemovalFailed({ code: 200, data: { successFlag: "CREATE_TASK_FAILED" } })).toBe(
      true,
    );
    expect(vocalRemovalFailed({ code: 200, data: { successFlag: "SUCCESS" } })).toBe(false);
  });

  it("only treats a paid Nasheed as one", async () => {
    const db = fakeDb({});
    expect(await isPaidNasheed(db, { ...baseSong(), unlocked: false })).toBe(false);
    expect(await isPaidNasheed(fakeDb({}, ["song-1"]), { ...baseSong(), unlocked: false })).toBe(
      true,
    );
    expect(await isPaidNasheed(db, baseSong())).toBe(true);
    expect(await isPaidNasheed(db, { ...baseSong(), is_nasheed: false })).toBe(false);
  });

  it("asks for separation on Take 1 only, once", async () => {
    stubEngine();
    const db = fakeDb({ "song-1": baseSong() });
    const ok = await requestVocalSeparation(db, db.rows["song-1"], [take("t1"), take("t2")], {
      apiKey: "k",
      callbackUrl: "https://x/cb",
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      taskId: "task-1",
      audioId: "t1",
      callBackUrl: "https://x/cb",
    });
    expect(db.rows["song-1"]).toMatchObject({
      status: "processing",
      stem_task_id: "stem-1",
      stem_source_clip_id: "t1",
    });
    // Second call for the same take doesn't ask again.
    await requestVocalSeparation(db, db.rows["song-1"], [take("t1")], {
      apiKey: "k",
      callbackUrl: "x",
    });
    expect(calls).toHaveLength(1);
  });

  it("schedules a retry when the engine refuses the separation", async () => {
    stubEngine({ separate: { code: 429, msg: "busy" } });
    const db = fakeDb({ "song-1": baseSong() });
    expect(
      await requestVocalSeparation(db, db.rows["song-1"], [take("t1")], {
        apiKey: "k",
        callbackUrl: "x",
      }),
    ).toBe(false);
    expect(db.rows["song-1"]).toMatchObject({ status: "failed", failure_class: "retryable" });
  });
});

describe("Nasheed delivery (completion webhook)", () => {
  it("never saves the mix or Take 2 for a paid Nasheed", async () => {
    stubEngine();
    const db = fakeDb({ "song-1": baseSong() });
    const res = await edgeMaterialise(db, db.rows["song-1"], [take("t1"), take("t2")], {
      nasheedStems: { apiKey: "k", callbackUrl: "https://x/cb?stage=stems" },
    });
    expect(res.completed).toBe(0);
    expect(res.skipped.length).toBeGreaterThan(0);
    expect(db.uploads).toHaveLength(0);
    expect(Object.keys(db.rows)).toEqual(["song-1"]);
    expect(db.rows["song-1"].stem_task_id).toBe("stem-1");
  });

  it("saves the acapella as the only audio when separation finishes", async () => {
    stubEngine();
    const db = fakeDb({
      "song-1": { ...baseSong(), status: "processing", stem_source_clip_id: "t1" },
    });
    const res = await edgeMaterialise(
      db,
      { ...db.rows["song-1"], is_nasheed: false, sample_path: null, audio_path: null },
      [{ audioUrl: "https://tempfile.aiquickdraw.com/vocals.mp3", clipId: "t1:vocals" }],
    );
    expect(res.parentCompleted).toBe(true);
    expect(db.rows["song-1"]).toMatchObject({ status: "completed", suno_clip_id: "t1:vocals" });
    expect(db.uploads.sort()).toEqual(["user-1/song-1.mp3", "user-1/song-1.sample.mp3"]);
    expect(Object.keys(db.rows)).toEqual(["song-1"]);
  });

  it("treats an unpaid Nasheed-style track as a normal track", async () => {
    stubEngine();
    const db = fakeDb({ "song-1": { ...baseSong(), unlocked: false } });
    const res = await edgeMaterialise(db, db.rows["song-1"], [take("t1")], {
      nasheedStems: { apiKey: "k", callbackUrl: "x" },
    });
    expect(res.parentCompleted).toBe(true);
    expect(calls.some((c) => c.url.includes("vocal-removal"))).toBe(false);
  });
});

describe("Nasheed recovery (app retry sweep)", () => {
  beforeEach(() => {
    process.env.SUNO_API_KEY = "k";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SUPABASE_URL = "https://backend.example";
  });

  it("finishes the track from a completed separation", async () => {
    stubEngine({
      record: {
        code: 200,
        data: { response: { vocalUrl: "https://tempfile.aiquickdraw.com/v.mp3" } },
      },
    });
    const db = fakeDb({
      "song-1": {
        ...baseSong(),
        status: "processing",
        stem_task_id: "stem-1",
        stem_source_clip_id: "t1",
      },
    });
    const res = await appMaterialise(db as never, db.rows["song-1"], [take("t1"), take("t2")]);
    expect(res.parentCompleted).toBe(true);
    expect(db.rows["song-1"].suno_clip_id).toBe("t1:vocals");
    expect(Object.keys(db.rows)).toEqual(["song-1"]);
  });

  it("keeps waiting while separation runs, and restarts it if it failed", async () => {
    stubEngine();
    const db = fakeDb({
      "song-1": { ...baseSong(), stem_task_id: "stem-0", stem_source_clip_id: "t1" },
    });
    const waiting = await appMaterialise(db as never, db.rows["song-1"], [take("t1")]);
    expect(waiting.pending).toBe(true);
    expect(db.rows["song-1"].status).toBe("processing");

    stubEngine({ record: { code: 200, data: { successFlag: "GENERATE_AUDIO_FAILED" } } });
    await appMaterialise(db as never, { ...db.rows["song-1"] }, [take("t1")]);
    expect(calls.some((c) => c.url.includes("vocal-removal/generate"))).toBe(true);
    expect(calls.find((c) => c.url.includes("vocal-removal/generate"))?.body.callBackUrl).toContain(
      "stage=stems",
    );
  });
});
