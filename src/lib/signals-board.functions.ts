import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SignalSummary } from "./trade-signal-context.server";

/** The markets on the OG Signals page, and how each is asked for. */
export const BOARD_MARKETS = [
  { code: "XAUUSD", ask: "gold", group: "Metals" },
  { code: "XAGUSD", ask: "silver", group: "Metals" },
  { code: "BTCUSD", ask: "BTCUSD", group: "Crypto" },
  { code: "ETHUSD", ask: "ETHUSD", group: "Crypto" },
  { code: "SOLUSD", ask: "SOLUSD", group: "Crypto" },
  { code: "EURUSD", ask: "EURUSD", group: "Forex" },
  { code: "GBPUSD", ask: "GBPUSD", group: "Forex" },
  { code: "USDJPY", ask: "USDJPY", group: "Forex" },
  { code: "NAS100", ask: "nas100", group: "Indices" },
  { code: "US30", ask: "us30", group: "Indices" },
  { code: "USOIL", ask: "wti", group: "Indices" },
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
  });
