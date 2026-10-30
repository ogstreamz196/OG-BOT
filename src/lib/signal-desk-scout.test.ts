import { describe, expect, test } from "vitest";
import {
  DESK_VETO_MS,
  deskCard,
  deskConfirmer,
  deskScoutDue,
  maybeDeskScout,
  scanAndBroadcast,
} from "./signal-broadcast.server";
import { deskAgrees, deskBacks, type DeskDecision } from "./signal-desk.server";

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
        rows.push({ created_at: new Date().toISOString(), ...row });
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
  test("every 10 minutes", () => {
    expect(deskScoutDue(null, T0)).toBe(true);
    expect(deskScoutDue(new Date(T0 - 5 * 60_000).toISOString(), T0)).toBe(false);
    expect(deskScoutDue(new Date(T0 - 9.6 * 60_000).toISOString(), T0)).toBe(true);
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
    expect(posted[0]).toBe(signal("XAUUSD", "BUY", 55).reply);
    expect(posted[0]).not.toMatch(/\bAIs?\b|DESK/);
    expect(followed).toEqual([1]);
    expect(out).toContain("XAU: posted BUY");
    expect(out).toContain("BTC: desk split");
    expect(tables.signal_broadcasts).toHaveLength(1);
    // The slot is claimed: a minute later it doesn't scout again.
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

describe("key-time checks", () => {
  test("each time is in its own market's clock, daylight saving included", async () => {
    const { zonedToday } = await import("./signal-broadcast.server");
    const summer = Date.parse("2026-07-15T06:00:00Z");
    const winter = Date.parse("2026-12-02T06:00:00Z");
    expect(new Date(zonedToday(summer, "Europe/London", 8, 0).at).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
    expect(new Date(zonedToday(winter, "Europe/London", 8, 0).at).toISOString()).toBe(
      "2026-12-02T08:00:00.000Z",
    );
    expect(new Date(zonedToday(summer, "America/New_York", 9, 30).at).toISOString()).toBe(
      "2026-07-15T13:30:00.000Z",
    );
    expect(new Date(zonedToday(winter, "America/New_York", 9, 30).at).toISOString()).toBe(
      "2026-12-02T14:30:00.000Z",
    );
  });

  test("a check is due 3 to 10 minutes after a key time, once, on weekdays", async () => {
    const { keySlotDue } = await import("./signal-broadcast.server");
    const londonOpen = Date.parse("2026-12-02T08:00:00Z"); // a Wednesday
    expect(keySlotDue(londonOpen + 60_000, [], null)).toBeNull();
    const due = keySlotDue(londonOpen + 4 * 60_000, [], null);
    expect(due).toEqual({ id: "london:2026-12-02", label: "London open" });
    expect(keySlotDue(londonOpen + 4 * 60_000, [], due!.id)).toBeNull();
    expect(keySlotDue(londonOpen + 11 * 60_000, [], null)).toBeNull();
    // Saturday: no market opens.
    expect(keySlotDue(Date.parse("2026-12-05T08:04:00Z"), [], null)).toBeNull();
  });

  test("high-impact USD news gets a check too, other news doesn't", async () => {
    const { keySlotDue } = await import("./signal-broadcast.server");
    const at = Date.parse("2026-12-05T18:00:00Z");
    const news = [
      { title: "Non-Farm Payrolls", currency: "USD", at, impact: "High" },
      { title: "German CPI", currency: "EUR", at, impact: "High" },
    ];
    expect(keySlotDue(at + 5 * 60_000, news, null)).toEqual({
      id: `news:${at}`,
      label: "After Non-Farm Payrolls",
    });
    expect(keySlotDue(at + 5 * 60_000, news.slice(1), null)).toBeNull();
  });

  test("the scout runs at a key time even when the hourly check isn't due", async () => {
    const { db, tables } = fakeDb();
    const londonOpen = Date.parse("2026-12-02T08:00:00Z");
    tables.site_content.push({
      key: "signals.deskScout.lastAt",
      value: new Date(londonOpen - 10 * 60_000).toISOString(),
    });
    const out = await maybeDeskScout(db, {
      read: async () => ({ signal: { reply: "x" }, desk: null }),
      post: async () => 1,
      now: () => londonOpen + 4 * 60_000,
    });
    expect(out).toMatch(/^London open: /);
    const again = await maybeDeskScout(db, {
      read: async () => ({ signal: { reply: "x" }, desk: null }),
      post: async () => 1,
      now: () => londonOpen + 5 * 60_000,
    });
    expect(again).toBe("not due");
  });
});

describe("deskBacks", () => {
  test("the chief's side, with more analysts for it than against", () => {
    expect(deskBacks(desk("BUY", ["BUY", "BUY", "SELL", "WAIT"]), "BUY")).toBe(true);
    expect(deskBacks(desk("BUY", ["BUY", "WAIT", "WAIT"]), "BUY")).toBe(true);
    expect(deskBacks(desk("BUY", ["BUY", "SELL", "SELL"]), "BUY")).toBe(false);
    expect(deskBacks(desk("SELL", ["SELL", "SELL", "SELL"]), "BUY")).toBe(false);
    expect(deskBacks(null, "BUY")).toBe(false);
  });
});

describe("the desk checks the chart engine's 70%+ alerts", () => {
  const scanDeps = (
    db: unknown,
    read: Parameters<typeof deskConfirmer>[1],
    now = T0,
    askUntil = T0 + 20_000,
  ) => {
    const posted: string[] = [];
    let asked = 0;
    return {
      posted,
      asked: () => asked,
      deps: {
        build: async (ask: string) =>
          /xau|gold/i.test(ask) ? signal("XAUUSD", "BUY", 80) : { reply: "wait" },
        post: async (text: string) => (posted.push(text), posted.length),
        confirm: deskConfirmer(
          db,
          async (ask) => {
            asked++;
            return read(ask);
          },
          { now: () => now, askUntil },
        ),
        now: () => now,
      },
    };
  };

  test("posted when the desk backs it, with the chief's take profit", async () => {
    const { db } = fakeDb();
    const moved = { ...signal("XAUUSD", "BUY", 80), reply: "card with the chief's take profit" };
    const run = scanDeps(db, async () => ({
      signal: moved,
      desk: desk("BUY", ["BUY", "BUY", "WAIT", "SELL"]),
    }));
    expect((await scanAndBroadcast(db, run.deps)).posted).toEqual(["XAUUSD BUY"]);
    expect(run.posted).toEqual(["card with the chief's take profit"]);
    // A repeat never asks the AIs again.
    const again = scanDeps(db, async () => {
      throw new Error("shouldn't ask");
    });
    expect((await scanAndBroadcast(db, again.deps)).posted).toEqual([]);
    expect(again.asked()).toBe(0);
  });

  test("turned down, that side isn't re-asked for 10 minutes", async () => {
    const { db } = fakeDb();
    const against = async () => ({
      signal: signal("XAUUSD", "BUY", 80),
      desk: desk("SELL", ["SELL", "SELL", "BUY"]),
    });
    const run = scanDeps(db, against);
    expect((await scanAndBroadcast(db, run.deps)).posted).toEqual([]);
    expect(run.asked()).toBe(1);
    const soon = scanDeps(db, against, T0 + 60_000, T0 + 80_000);
    await scanAndBroadcast(db, soon.deps);
    expect(soon.asked()).toBe(0);
    const later = scanDeps(db, against, T0 + DESK_VETO_MS + 1, T0 + DESK_VETO_MS + 20_000);
    await scanAndBroadcast(db, later.deps);
    expect(later.asked()).toBe(1);
  });

  test("with no AI answering, the engine's alert stands; too late in a run, it waits", async () => {
    const { db } = fakeDb();
    const down = scanDeps(db, async () => ({ signal: signal("XAUUSD", "BUY", 80), desk: null }));
    expect((await scanAndBroadcast(db, down.deps)).posted).toEqual(["XAUUSD BUY"]);
    const { db: db2 } = fakeDb();
    const late = scanDeps(
      db2,
      async () => ({ signal: signal("XAUUSD", "BUY", 80), desk: null }),
      T0 + 30_000,
    );
    expect((await scanAndBroadcast(db2, late.deps)).posted).toEqual([]);
    expect(late.asked()).toBe(0);
  });
});

describe("what isn't sent is shadowed, and alerts carry the desk's say", () => {
  test("waits and under-70 setups become shadows; a turned-down alert too", async () => {
    const { db } = fakeDb();
    const shadows: string[] = [];
    const vetoed: string[] = [];
    const followed: unknown[] = [];
    const wait = {
      reply: "wait",
      summary: { waitReason: "Too quiet: price is barely moving, so targets rarely get reached." },
    } as never;
    const deps = {
      build: async (ask: string) => (/xau|gold/i.test(ask) ? wait : signal("BTCUSD", "SELL", 64)),
      post: async () => 1,
      shadow: async (_s: unknown, why: string) => void shadows.push(why),
      now: () => T0,
    };
    await scanAndBroadcast(db, deps);
    expect(shadows).toEqual(["quiet", "below_alert"]);

    const { db: db2 } = fakeDb();
    const confirm = deskConfirmer(
      db2,
      async () => ({ signal: signal("XAUUSD", "BUY", 80), desk: desk("SELL", ["SELL", "SELL"]) }),
      {
        now: () => T0,
        askUntil: T0 + 20_000,
        onVeto: async (s) => void vetoed.push(s.plan!.market),
      },
    );
    await scanAndBroadcast(db2, {
      build: async (ask: string) =>
        /xau|gold/i.test(ask) ? signal("XAUUSD", "BUY", 80) : { reply: "" },
      post: async () => 1,
      confirm,
      now: () => T0,
    });
    expect(vetoed).toEqual(["XAUUSD"]);

    const { db: db3 } = fakeDb();
    const backing = deskConfirmer(
      db3,
      async () => ({
        signal: signal("XAUUSD", "BUY", 80),
        desk: desk("BUY", ["BUY", "BUY", "WAIT"]),
      }),
      { now: () => T0, askUntil: T0 + 20_000 },
    );
    await scanAndBroadcast(db3, {
      build: async (ask: string) =>
        /xau|gold/i.test(ask) ? signal("XAUUSD", "BUY", 80) : { reply: "" },
      post: async () => 1,
      confirm: backing,
      follow: async (s) => void followed.push(s.plan!.feeds),
      now: () => T0,
    });
    expect(followed).toEqual([{ desk: "backed" }]);
  });
});
