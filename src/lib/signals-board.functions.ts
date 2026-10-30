import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SignalSummary } from "./trade-signal-context.server";
import type { SignalRecord } from "./signal-record.server";

/**
 * The markets on the OG Signals page, and how each is asked for: gold and
 * bitcoin only, the two the bot posts, learns and is followed on.
 */
export const BOARD_MARKETS = [
  { code: "XAUUSD", ask: "gold", group: "Metals" },
  { code: "BTCUSD", ask: "BTCUSD", group: "Crypto" },
] as const;

export type BoardFrame = "1H" | "15M";
export type BoardMarket = (typeof BOARD_MARKETS)[number]["code"];

export type BoardRow =
  | { code: BoardMarket; ok: true; signal: SignalSummary }
  | { code: BoardMarket; ok: false };

export type SignalsBoard =
  | { open: false }
  | { open: true; staffOnly: boolean; frame: BoardFrame; rows: BoardRow[]; at: string };

async function access(userId: string): Promise<{ open: boolean; staffOnly: boolean }> {
  const { cached } = await import("./server-cache");
  // Per member for 30s: the page asks once per market card.
  return cached(`signals-access:${userId}`, 30_000, () => readAccess(userId));
}

async function readAccess(userId: string): Promise<{ open: boolean; staffOnly: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { cached } = await import("./server-cache");
  const [enabled, roles] = await Promise.all([
    cached("signals-portal-enabled", 30_000, async () => {
      const { data } = await (supabaseAdmin as any)
        .from("app_settings")
        .select("value")
        .eq("key", "signals_portal_enabled")
        .maybeSingle();
      const v = (data as { value?: unknown } | null)?.value;
      return v !== false && v !== "false";
    }),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const staff = (roles.data ?? []).some((r: { role: string }) =>
    ["admin", "boss", "dev"].includes(r.role),
  );
  // Switched off: only the Boss's team can still look (to check it before reopening).
  return { open: enabled || staff, staffOnly: !enabled && staff };
}

/**
 * Every market's current signal for one timeframe, from the same engine and
 * caches as Telegram signals (so a busy page doesn't hammer the feeds).
 */
export const getSignalsBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { frame: BoardFrame } => ({
    frame: (d as { frame?: unknown } | null)?.frame === "15M" ? "15M" : "1H",
  }))
  .handler(async ({ context, data }): Promise<SignalsBoard> => {
    const gate = await access(context.userId);
    if (!gate.open) return { open: false };
    const { buildTradeSignal } = await import("./trade-signal-context.server");
    const { mapPool } = await import("./map-pool");
    const tf = data.frame === "15M" ? "15m" : "1h";
    const rows = await mapPool(BOARD_MARKETS, 4, async (m): Promise<BoardRow> => {
      try {
        const res = await buildTradeSignal(`${m.ask} signal ${tf}`);
        return res.summary
          ? { code: m.code, ok: true, signal: res.summary }
          : { code: m.code, ok: false };
      } catch (e) {
        console.warn("[signals-board]", m.code, e);
        return { code: m.code, ok: false };
      }
    });
    return {
      open: true,
      staffOnly: gate.staffOnly,
      frame: data.frame,
      rows,
      at: new Date().toISOString(),
    };
  });

export type BoardPrices = Partial<
  Record<BoardMarket, { feed: number | null; spot: number | null }>
>;

/**
 * Latest prices for the board, every few seconds: the chart feed's price,
 * plus the spot price for markets charted from a proxy (gold, silver).
 */
export const getBoardPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BoardPrices> => {
    const gate = await access(context.userId);
    if (!gate.open) return {};
    // Shared by everyone with the page open, so the feeds are asked once per few seconds.
    const { cached } = await import("./server-cache");
    return cached("signals-board-prices", 3_000, readPrices);
  });

async function readPrices(): Promise<BoardPrices> {
  const { livePrice, spotPrice } = await import("./trade-signal-context.server");
  const { parseInstrument } = await import("./trade-signal");
  const out: BoardPrices = {};
  const num = (v: number) => (Number.isFinite(v) && v > 0 ? v : null);
  await Promise.all(
    BOARD_MARKETS.map(async (m) => {
      const inst = parseInstrument(m.ask);
      if (!inst) return;
      const [feed, spot] = await Promise.all([
        livePrice(inst).catch(() => NaN),
        spotPrice(inst).catch(() => NaN),
      ]);
      out[m.code] = { feed: num(feed), spot: num(spot) };
    }),
  );
  return out;
}

export type SignalsOverview =
  | { open: false }
  | { open: true; staffOnly: boolean; record: SignalRecord | null };

/**
 * Whether the page is open for this member, and the signal record (the same
 * win rate as the Telegram scoreboard: 70%+ signals since the Boss's last
 * reset, won vs lost). Cached a minute on the server.
 */
export const getSignalsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SignalsOverview> => {
    const gate = await access(context.userId);
    if (!gate.open) return { open: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { cached } = await import("./server-cache");
    const { signalRecord } = await import("./signal-record.server");
    const record = await cached("signal-record", 60_000, () => signalRecord(supabaseAdmin)).catch(
      () => null,
    );
    return { open: true, staffOnly: gate.staffOnly, record };
  });

/**
 * One market's signal, so the page fills in card by card instead of waiting
 * for every market. Same engine and caches as getSignalsBoard.
 */
export const getSignalCard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { frame: BoardFrame; code: BoardMarket } => {
    const v = d as { frame?: unknown; code?: unknown } | null;
    const market = BOARD_MARKETS.find((m) => m.code === v?.code);
    if (!market) throw new Error("Unknown market");
    return { frame: v?.frame === "15M" ? "15M" : "1H", code: market.code };
  })
  .handler(async ({ context, data }): Promise<BoardRow | null> => {
    const gate = await access(context.userId);
    if (!gate.open) return null;
    const market = BOARD_MARKETS.find((m) => m.code === data.code)!;
    const { buildTradeSignal } = await import("./trade-signal-context.server");
    try {
      const res = await buildTradeSignal(
        `${market.ask} signal ${data.frame === "15M" ? "15m" : "1h"}`,
      );
      return res.summary
        ? { code: market.code, ok: true, signal: res.summary }
        : { code: market.code, ok: false };
    } catch (e) {
      console.warn("[signals-board]", market.code, e);
      return { code: market.code, ok: false };
    }
  });
