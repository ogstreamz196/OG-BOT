import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./engine-config";

const state: { cfg: EngineConfig; hft: boolean } = { cfg: DEFAULT_ENGINE_CONFIG, hft: false };
vi.mock("./signal-chat.server", async (orig) => ({
  ...(await orig<object>()),
  chatPurgedAt: async () => null,
}));
vi.mock("./engine-config.server", () => ({
  engineConfig: async () => state.cfg,
  saveEngineConfig: async (_a: unknown, c: EngineConfig) => c,
}));
vi.mock("./copy-mirror.server", () => ({ hftOn: async () => state.hft }));

import { scanAndBroadcast, type ScanDeps } from "./signal-broadcast.server";
import type { ScanNote } from "./signal-scan-log";

type Row = Record<string, unknown>;
function fakeDb() {
  const tables: Record<string, Row[]> = {};
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      gte: (c: string, v: unknown) => (filters.push((r) => String(r[c]) >= String(v)), q),
      insert: (row: Row) => (rows.push(row), Promise.resolve({ error: null })),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: rows.filter((r) => filters.every((f) => f(r))).reverse(), error: null }),
    };
    return q;
  };
  return { from };
}

const T0 = Date.parse("2026-10-26T12:00:00Z");
const card = (market: string, confidencePct = 80) => ({
  reply: `${market} BUY card`,
  summary: { timeframe: "5M" },
  plan: {
    market,
    label: market,
    direction: "BUY" as const,
    confidencePct,
    entry: 100,
    expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
  },
});

function deps(extra: Partial<ScanDeps> = {}) {
  const sent: string[] = [];
  const notes: ScanNote[] = [];
  const d: ScanDeps = {
    build: async (ask) => (ask.startsWith("XAU") ? card("XAUUSD") : card("BTCUSD")) as never,
    post: async (text) => (sent.push(text), sent.length),
    now: () => T0,
    note: (n) => void notes.push(n),
    ...extra,
  };
  return { d, sent, notes };
}
const outcomes = (notes: ScanNote[]) => notes.map((n) => `${n.market}:${n.outcome}`).sort();

beforeEach(() => {
  state.cfg = structuredClone(DEFAULT_ENGINE_CONFIG);
  state.hft = false;
});

describe("the signals group switchboard (Copy Trader B0T card)", () => {
  test("posting off: nothing goes out, and the log says why", async () => {
    state.cfg.group.posting = false;
    const { d, sent, notes } = deps();
    expect((await scanAndBroadcast(fakeDb(), d)).posted).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(outcomes(notes)).toEqual(["BTCUSD:switched_off", "XAUUSD:switched_off"]);
  });

  test("gold off: bitcoin still posts", async () => {
    state.cfg.group.gold = false;
    const { d, notes } = deps();
    expect((await scanAndBroadcast(fakeDb(), d)).posted).toEqual(["BTCUSD BUY"]);
    expect(outcomes(notes)).toEqual(["BTCUSD:posted", "XAUUSD:switched_off"]);
  });

  test("the AI desk's no holds an alert back, and is noted", async () => {
    const confirm = vi.fn(async () => null);
    const { d, sent, notes } = deps({ confirm });
    await scanAndBroadcast(fakeDb(), d);
    expect(confirm).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(outcomes(notes)).toEqual(["BTCUSD:desk_no", "XAUUSD:desk_no"]);
  });

  test("high-frequency mode doesn't wait for the desk (floor and gate unchanged)", async () => {
    state.hft = true;
    const confirm = vi.fn(async () => null);
    const { d, sent } = deps({ confirm });
    expect((await scanAndBroadcast(fakeDb(), d)).posted.sort()).toEqual([
      "BTCUSD BUY",
      "XAUUSD BUY",
    ]);
    expect(confirm).not.toHaveBeenCalled();
    expect(sent).toHaveLength(2);
  });

  test("desk double-check switched off: no wait either", async () => {
    state.cfg.group.deskCheck = false;
    const confirm = vi.fn(async () => null);
    const { d } = deps({ confirm });
    expect((await scanAndBroadcast(fakeDb(), d)).posted).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("too late in the minute for the desk: noted, not silently lost", async () => {
    const confirm = vi.fn(async () => card("BTCUSD") as never);
    const { d, notes } = deps({ confirm, deskUntil: T0 - 1 });
    await scanAndBroadcast(fakeDb(), d);
    expect(confirm).not.toHaveBeenCalled();
    expect(outcomes(notes)).toEqual(["BTCUSD:desk_late", "XAUUSD:desk_late"]);
  });

  test("high-frequency still keeps the confidence floor", async () => {
    state.hft = true;
    const { d, sent, notes } = deps({ build: async () => card("BTCUSD", 40) as never });
    await scanAndBroadcast(fakeDb(), d);
    expect(sent).toHaveLength(0);
    expect(notes.every((n) => n.outcome === "below_bar")).toBe(true);
  });

  test("a chart with no setup is logged as waiting", async () => {
    const { d, notes } = deps({
      build: async () => ({ reply: "wait", summary: { waitReason: "Choppy" } }) as never,
    });
    await scanAndBroadcast(fakeDb(), d);
    expect(notes.map((n) => n.outcome)).toEqual(["waiting", "waiting"]);
  });
});
