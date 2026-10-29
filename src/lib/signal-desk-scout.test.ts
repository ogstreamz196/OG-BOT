import { describe, expect, test } from "vitest";
import { deskCard, deskScoutDue, maybeDeskScout } from "./signal-broadcast.server";
import { deskAgrees, type DeskDecision } from "./signal-desk.server";

type Row = Record<string, unknown>;

/** Just enough of the database client for site_content and signal_broadcasts. */
function fakeDb() {
  const tables: Record<string, Row[]> = { site_content: [], signal_broadcasts: [] };
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    const found = () => rows.filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      maybeSingle: () => Promise.resolve({ data: found()[0] ?? null, error: null }),
      upsert: (row: Row) => {
        const i = rows.findIndex((r) => r.key === row.key);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
        return Promise.resolve({ error: null });
      },
      insert: (row: Row) => {
        rows.push({ ...row, created_at: new Date().toISOString() });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: found().reverse(), error: null }),
    };
    return q;
  };
  return { db: { from }, tables };
}

const T0 = Date.parse("2026-10-29T14:00:00Z");

const desk = (
  direction: "BUY" | "SELL",
  leans: ("BUY" | "SELL" | "WAIT")[],
  byVote = false,
): DeskDecision => ({
  direction,
  call: "Bulls in charge.",
  findings: leans.map((lean, i) => ({
    role: (["trend", "levels", "momentum", "risk"] as const)[i],
    lean,
    conviction: 70,
    finding: "Higher lows on every frame.",
  })),
  ...(byVote ? { byVote } : {}),
});

const signal = (market: string, direction: "BUY" | "SELL", confidencePct: number) => ({
  reply: `🟢 I'm BUYING · ${market}\n▶️ I'm gonna enter @ 100`,
  plan: {
    market,
    label: market,
    direction,
    confidencePct,
    entry: 100,
    expiresAt: new Date(T0 + 3600_000).toISOString(),
  },
});

describe("deskAgrees", () => {
  test("every analyst leans the chief's way", () => {
    expect(deskAgrees(desk("BUY", ["BUY", "BUY", "BUY", "BUY"]))).toBe(true);
    expect(deskAgrees(desk("SELL", ["SELL", "SELL", "SELL"]))).toBe(true);
  });
  test("one wait or one the other way splits the desk", () => {
    expect(deskAgrees(desk("BUY", ["BUY", "BUY", "WAIT", "BUY"]))).toBe(false);
    expect(deskAgrees(desk("BUY", ["BUY", "SELL", "BUY", "BUY"]))).toBe(false);
  });
  test("too few answers, or no chief, isn't everyone agreeing", () => {
    expect(deskAgrees(desk("BUY", ["BUY", "BUY"]))).toBe(false);
    expect(deskAgrees(desk("BUY", ["BUY", "BUY", "BUY", "BUY"], true))).toBe(false);
    expect(deskAgrees(null)).toBe(false);
  });
});

describe("deskScoutDue", () => {
  test("once an hour", () => {
    expect(deskScoutDue(null, T0)).toBe(true);
    expect(deskScoutDue(new Date(T0 - 30 * 60_000).toISOString(), T0)).toBe(false);
    expect(deskScoutDue(new Date(T0 - 59.6 * 60_000).toISOString(), T0)).toBe(true);
  });
});

describe("maybeDeskScout", () => {
  test("posts a desk alert when every AI agrees, even at low confidence", async () => {
    const { db, tables } = fakeDb();
    const posted: string[] = [];
    const followed: number[] = [];
    const out = await maybeDeskScout(db, {
      read: async (ask) =>
        /gold|xau/i.test(ask)
          ? { signal: signal("XAUUSD", "BUY", 55), desk: desk("BUY", ["BUY", "BUY", "BUY", "BUY"]) }
          : { signal: signal("BTCUSD", "SELL", 60), desk: desk("SELL", ["SELL", "WAIT", "SELL"]) },
      post: async (text) => (posted.push(text), posted.length),
      follow: async (_s, id) => void followed.push(id),
      now: () => T0,
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toBe(deskCard(signal("XAUUSD", "BUY", 55).reply));
    expect(posted[0]).toMatch(/^🚨 TRADE ALERT\n\n/);
    expect(posted[0]).not.toMatch(/\bAIs?\b|DESK/);
    expect(followed).toEqual([1]);
    expect(out).toContain("XAU: posted BUY");
    expect(out).toContain("BTC: desk split");
    expect(tables.signal_broadcasts).toHaveLength(1);
    // The hour is claimed: a minute later it doesn't scout again.
    const again = await maybeDeskScout(db, {
      read: async () => {
        throw new Error("shouldn't scout");
      },
      post: async () => 1,
      now: () => T0 + 60_000,
    });
    expect(again).toBe("not due");
  });

  test("no real signal the desk's way (a bias call) isn't posted", async () => {
    const { db } = fakeDb();
    const posted: string[] = [];
    const out = await maybeDeskScout(db, {
      read: async () => ({
        signal: { reply: "⚠️ MARKET BIAS · this isn't my signal" },
        desk: desk("BUY", ["BUY", "BUY", "BUY", "BUY"]),
      }),
      post: async (text) => (posted.push(text), 1),
      now: () => T0,
    });
    expect(posted).toEqual([]);
    expect(out).toContain("no signal that way");
  });

  test("a market already posted the same way isn't repeated", async () => {
    const { db, tables } = fakeDb();
    tables.signal_broadcasts.push({
      market: "XAUUSD",
      direction: "BUY",
      expires_at: new Date(T0 + 600_000).toISOString(),
      created_at: new Date(T0 - 60_000).toISOString(),
    });
    const posted: string[] = [];
    const out = await maybeDeskScout(db, {
      read: async (ask) => ({
        signal: signal(/gold|xau/i.test(ask) ? "XAUUSD" : "BTCUSD", "BUY", 80),
        desk: desk("BUY", ["BUY", "BUY", "BUY", "BUY"]),
      }),
      post: async (text) => (posted.push(text), posted.length),
      now: () => T0,
    });
    expect(out).toContain("XAU: already posted");
    expect(out).toContain("BTC: posted BUY");
    expect(posted).toHaveLength(1);
  });
});
