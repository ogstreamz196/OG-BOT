import { afterEach, describe, expect, it, vi } from "vitest";
import { factCheckNote, unsupportedFigures } from "./fact-check";
import { detectFootball, form, lean, ordinal, parseScoreboard, parseStandings } from "./football";
import { buildFootballContext } from "./football-context.server";
import { isSensitive, memoryNote, parseMemoryUpdate, shouldExtract } from "./og-memory";

const realFetch = globalThis.fetch;
const realGroq = process.env.GROQ_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realGroq === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroq;
});

describe("memory", () => {
  it("only checks messages where the member talks about themselves", () => {
    expect(shouldExtract("I support Spurs and my mate Dan is Arsenal")).toBe(true);
    expect(shouldExtract("forget that I said I live in Leeds")).toBe(true);
    expect(shouldExtract("lol")).toBe(false);
    expect(shouldExtract("what time is it in Tokyo")).toBe(false);
  });

  it("never keeps sensitive details", () => {
    expect(isSensitive("Is a Muslim")).toBe(true);
    expect(isSensitive("Has ADHD")).toBe(true);
    expect(isSensitive("Phone number is 07700900123")).toBe(true);
    expect(isSensitive("Email is dan@x.com")).toBe(true);
    expect(isSensitive("Supports Spurs")).toBe(false);
    expect(isSensitive("Rap name is Lil Bricks")).toBe(false);
  });

  it("reads the extractor reply safely", () => {
    const existing = ["Supports Arsenal", "Lives in Leeds"];
    const raw = `<think>hmm</think> Sure: {"remember": ["Supports Spurs", "Supports Spurs", "Votes Labour", "Rap name is Lil Bricks.", "x"], "forget": ["Supports Arsenal", "Made up fact"]}`;
    expect(parseMemoryUpdate(raw, existing)).toEqual({
      remember: ["Supports Spurs", "Rap name is Lil Bricks"],
      forget: ["Supports Arsenal"],
    });
    expect(parseMemoryUpdate("not json", existing)).toEqual({ remember: [], forget: [] });
  });

  it("tells 0G B0T to use memories naturally, and stays empty with none", () => {
    expect(memoryNote([])).toBe("");
    const note = memoryNote(["Supports Spurs"]);
    expect(note).toContain("- Supports Spurs");
    expect(note).toContain("Never list them back");
  });
});

describe("fact check", () => {
  const data =
    "Price now: 2,650.40. Stop loss: 2632.1 (18.3 pips). Confidence: 62% (Medium). Arsenal 2-1 Chelsea (FT). Table: 3rd on 18 pts";
  it("passes figures that are in the data", () => {
    expect(
      unsupportedFigures(
        "Gold's at 2650.40, stop 2632.10, I'm 62% on it. Chelsea lost 1-2 lol. Since 2026 mate",
        [data],
      ),
    ).toEqual([]);
  });
  it("flags invented ones", () => {
    expect(unsupportedFigures("Target 2700.00, Arsenal won 3-0, 85% sure", [data])).toEqual([
      "2700",
      "3-0",
      "85%",
    ]);
    expect(factCheckNote(["2700"])).toContain("2700");
  });
});

const espnEvent = (
  date: string,
  state: string,
  home: string,
  hs: string,
  away: string,
  as: string,
) => ({
  date,
  status: { type: { state, shortDetail: state === "in" ? "67'" : "FT" } },
  competitions: [
    {
      competitors: [
        { homeAway: "home", score: hs, team: { displayName: home } },
        { homeAway: "away", score: as, team: { displayName: away } },
      ],
    },
  ],
});
const board = {
  events: [
    espnEvent("2026-09-20T14:00Z", "post", "Arsenal", "2", "Chelsea", "1"),
    espnEvent("2026-09-27T14:00Z", "post", "Tottenham Hotspur", "1", "Arsenal", "1"),
    espnEvent("2026-10-04T14:00Z", "post", "Arsenal", "0", "Liverpool", "3"),
    espnEvent("2026-10-25T14:00Z", "pre", "Arsenal", "0", "Tottenham Hotspur", "0"),
  ],
};
const stat = (name: string, value: number) => ({ name, value });
const row = (
  rank: number,
  team: string,
  p: number,
  w: number,
  d: number,
  l: number,
  gd: number,
  pts: number,
) => ({
  team: { displayName: team },
  stats: [
    stat("rank", rank),
    stat("gamesPlayed", p),
    stat("wins", w),
    stat("ties", d),
    stat("losses", l),
    stat("pointDifferential", gd),
    stat("points", pts),
  ],
});
const standings = {
  children: [
    {
      standings: {
        entries: [
          row(2, "Arsenal", 8, 5, 2, 1, 9, 17),
          row(1, "Liverpool", 8, 7, 1, 0, 14, 22),
          row(12, "Tottenham Hotspur", 8, 2, 3, 3, -2, 9),
        ],
      },
    },
  ],
};

describe("football", () => {
  it("spots football questions without grabbing ordinary chat", () => {
    expect(detectFootball("Who won the Arsenal game?")?.teams).toEqual([
      { name: "Arsenal", league: "eng.1" },
    ]);
    expect(detectFootball("prem table pls")?.leagues).toEqual(["eng.1"]);
    expect(detectFootball("did united win?")?.teams[0].name).toBe("Manchester United");
    expect(detectFootball("spurs are finished")?.teams[0].name).toBe("Tottenham");
    expect(detectFootball("I'm going to the city tonight")).toBeNull();
    expect(detectFootball("we're united as a family")).toBeNull();
    expect(detectFootball("hello mate")).toBeNull();
  });

  it("reads ESPN scores, table and form", () => {
    const matches = parseScoreboard(board);
    expect(matches).toHaveLength(4);
    expect(matches[3]).toMatchObject({ state: "pre", homeScore: null });
    const table = parseStandings(standings);
    expect(table.map((r) => r.team)).toEqual(["Liverpool", "Arsenal", "Tottenham Hotspur"]);
    expect(form(matches, "Arsenal")).toBe("WDL");
    expect(lean(table, "Arsenal", "Tottenham Hotspur")).toEqual({
      pick: "Arsenal to win",
      strength: "strong",
    });
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(22)).toBe("22nd");
  });

  it("builds the data block for a team, and nothing when the feed is down", async () => {
    globalThis.fetch = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.includes("standings") ? standings : board)),
    ) as unknown as typeof fetch;
    const out = await buildFootballContext("how are arsenal doing, who they got next?");
    expect(out).toContain("FOOTBALL DATA MODE");
    expect(out).toContain("ARSENAL (Premier League)");
    expect(out).toContain("Table: 2nd on 17 pts from 8 games (W5 D2 L1, GD +9)");
    expect(out).toContain("Form (oldest to newest): WDL");
    expect(out).toContain("Arsenal 0-3 Liverpool (FT)");
    expect(out).toMatch(/Next game: .* Arsenal v Tottenham Hotspur/);
    expect(out).toContain("Lean from the numbers: Arsenal to win (strong edge");

    globalThis.fetch = vi.fn(
      async () => new Response("down", { status: 503 }),
    ) as unknown as typeof fetch;
    expect(await buildFootballContext("celtic score?")).toBe("");
  });
});

describe("memory store", () => {
  function fakeDb(rows: { id: string; fact: string }[], enabled = true) {
    const log: string[] = [];
    const db = {
      log,
      rows,
      from(table: string) {
        const filters: Record<string, unknown> = {};
        let op: "select" | "delete" = "select";
        const q: any = {
          select: () => q,
          eq: (k: string, v: unknown) => ((filters[k] = v), q),
          ilike: (_k: string, v: string) => ((filters.ilike = v), q),
          in: (_k: string, v: string[]) => ((filters.in = v), q),
          order: () => q,
          limit: () => q,
          delete: () => ((op = "delete"), q),
          insert: async (r: { fact: string }[]) => {
            for (const x of r) rows.push({ id: `n${rows.length}`, fact: x.fact });
            log.push(`insert ${r.map((x) => x.fact).join("|")}`);
            return { error: null };
          },
          maybeSingle: async () => ({
            data: table === "user_preferences" ? { og_memory: enabled } : null,
          }),
          then: (res: (v: unknown) => void) => {
            if (op === "delete") {
              const before = rows.length;
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i];
                if (
                  filters.ilike !== undefined &&
                  r.fact.toLowerCase() !== String(filters.ilike).toLowerCase()
                )
                  continue;
                if (filters.in && !(filters.in as string[]).includes(r.id)) continue;
                rows.splice(i, 1);
              }
              log.push(`delete ${before - rows.length}`);
              return res({ error: null });
            }
            return res({ data: rows.map((r) => ({ ...r })), error: null });
          },
        };
        return q;
      },
    };
    return db;
  }
  const ai = (content: string) =>
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })));

  it("saves new facts and forgets corrected ones", async () => {
    process.env.GROQ_API_KEY = "q";
    globalThis.fetch = ai(
      '{"remember": ["Supports Spurs"], "forget": ["Supports Arsenal"]}',
    ) as unknown as typeof fetch;
    const { learnFromMessage, loadMemories } = await import("./og-memory.server");
    const db = fakeDb([{ id: "a", fact: "Supports Arsenal" }]);
    await learnFromMessage(db, "u", "I never supported Arsenal, I'm Spurs till I die", [
      "Supports Arsenal",
    ]);
    expect(db.rows.map((r) => r.fact)).toEqual(["Supports Spurs"]);
    expect(await loadMemories(db, "u")).toEqual(["Supports Spurs"]);
  });

  it("does nothing when memory is off or the message isn't about them", async () => {
    const spy = ai('{"remember": ["x y z"]}');
    globalThis.fetch = spy as unknown as typeof fetch;
    const { learnFromMessage, loadMemories } = await import("./og-memory.server");
    const off = fakeDb([{ id: "a", fact: "Supports Spurs" }], false);
    await learnFromMessage(off, "u", "I support Spurs and my mate is Dan", []);
    expect(await loadMemories(off, "u")).toEqual([]);
    await learnFromMessage(fakeDb([]), "u", "lol", []);
    expect(spy).not.toHaveBeenCalled();
  });
});
