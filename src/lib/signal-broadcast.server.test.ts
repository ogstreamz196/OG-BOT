import { describe, expect, test } from "vitest";
import {
  BROADCAST_MIN_CONFIDENCE,
  channelCard,
  scanAndBroadcast,
  type ScanDeps,
} from "./signal-broadcast.server";

type Row = Record<string, unknown>;

/** Just enough of the database client for signal_broadcasts. */
function fakeDb(opts: { broken?: boolean } = {}) {
  const rows: Row[] = [];
  const from = () => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      insert: (row: Row) => {
        rows.push({ ...row, created_at: new Date().toISOString() });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => void) =>
        resolve(
          opts.broken
            ? { data: null, error: { message: "relation does not exist" } }
            : { data: rows.filter((r) => filters.every((f) => f(r))).reverse(), error: null },
        ),
    };
    return q;
  };
  return { db: { from }, rows };
}

const T0 = Date.parse("2026-10-25T12:00:00Z");
const card = (market: string, direction: "BUY" | "SELL", confidencePct: number, mins = 60) => ({
  reply: `${market} ${direction} card\n\n⚠️ THIS AIN'T FINANCIAL ADVICE YOU BRAINLESS MUG. RISK 1–2% OR BLAME YOUR MUM.`,
  plan: {
    market,
    label: market,
    direction,
    confidencePct,
    entry: 100,
    expiresAt: new Date(T0 + mins * 60_000).toISOString(),
  },
});

function deps(
  signals: Record<string, ReturnType<typeof card> | { reply: string }>,
  now = T0,
): ScanDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    build: async (ask) => signals[ask.startsWith("XAU") ? "XAU" : "BTC"],
    post: async (text) => (sent.push(text), sent.length),
    now: () => now,
  };
}

describe("auto-posted scalp signals", () => {
  test("only top-confidence trades are posted, as a channel card", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: card("BTCUSD", "SELL", 89) });
    const result = await scanAndBroadcast(db, d);
    expect(result).toEqual({ checked: 2, posted: ["XAUUSD BUY"] });
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toMatch(/^🚨 TOP SCALP ALERT · every timeframe agrees\n\nXAUUSD BUY card/);
    // Cards never show a confidence %.
    expect(d.sent[0]).not.toMatch(/\d+%(?! OR)/);
    expect(d.sent[0]).toContain("THIS AIN'T FINANCIAL ADVICE");
    expect(BROADCAST_MIN_CONFIDENCE).toBe(90);
  });

  test("a 'wait' (no trade) is never posted", async () => {
    const { db } = fakeDb();
    const d = deps({ XAU: { reply: "wait card" }, BTC: { reply: "wait card" } });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
  });

  test("no repeats while a post is valid, unless it flips; posts again once it expires", async () => {
    const { db } = fakeDb();
    const gold = { XAU: card("XAUUSD", "BUY", 90, 60), BTC: { reply: "" } };
    expect((await scanAndBroadcast(db, deps(gold))).posted).toEqual(["XAUUSD BUY"]);
    // A minute later, same call: not again.
    expect((await scanAndBroadcast(db, deps(gold, T0 + 60_000))).posted).toEqual([]);
    // It flips to a SELL: that's news, so it goes out.
    const flipped = { XAU: card("XAUUSD", "SELL", 90, 60), BTC: { reply: "" } };
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 120_000))).posted).toEqual([
      "XAUUSD SELL",
    ]);
    // After the post's valid-until, a fresh one can go out.
    expect((await scanAndBroadcast(db, deps(flipped, T0 + 61 * 60_000))).posted).toEqual([
      "XAUUSD SELL",
    ]);
  });

  test("without the table, nothing is posted (it can't tell repeats apart)", async () => {
    const { db } = fakeDb({ broken: true });
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: card("BTCUSD", "BUY", 90) });
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
    expect(d.sent).toHaveLength(0);
  });

  test("a failed post isn't recorded, so the next scan tries again", async () => {
    const { db, rows } = fakeDb();
    const d = deps({ XAU: card("XAUUSD", "BUY", 90), BTC: { reply: "" } });
    d.post = async () => null;
    expect((await scanAndBroadcast(db, d)).posted).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  test("channel card wording", () => {
    expect(channelCard("x")).toBe("🚨 TOP SCALP ALERT · every timeframe agrees\n\nx");
  });
});
