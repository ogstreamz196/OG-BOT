import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CopySettings } from "./copy-feed";
import type { StrategyToggles } from "./engine-config";

async function assertBoss(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: string },
    ) => Promise<{ data: boolean | null }>;
  };
  const [admin, boss] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!admin.data && !boss.data) throw new Error("Forbidden");
}

export type TradingSwitches = { settings: CopySettings; strategies: StrategyToggles };

/**
 * The website may only send the copier card's own switch actions: pause or
 * resume, lot range, a market, the trade limit, the broker stop, high-frequency
 * and the four strategies. Pure.
 */
export function allowedAction(a: unknown): a is string {
  return (
    typeof a === "string" &&
    (/^cs:(pause|resume|refresh)$/.test(a) ||
      /^cs:band:(small|medium|large)$/.test(a) ||
      /^cs:mk:(XAUUSD|BTCUSD)$/.test(a) ||
      /^cs:open:(-1|1)$/.test(a) ||
      /^cs:(stop|hft):(on|off)$/.test(a) ||
      /^es:(sniper|hedges|rangeHedge|patternsAlongside):(on|off)$/.test(a))
  );
}

/** Boss: the copier settings and strategy switches as they are now. */
export const getTradingSwitches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TradingSwitches> => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { copierState } = await import("./copy-settings-bot.server");
    return copierState(supabaseAdmin);
  });

/** Boss: flip one switch, exactly as the Copy Trader B0T card's button does. */
export const setTradingSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { action?: unknown }) => {
    if (!allowedAction(d?.action)) throw new Error("Unknown switch");
    return { action: d.action as string };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyCopierAction } = await import("./copy-settings-bot.server");
    return applyCopierAction(supabaseAdmin, context.userId, data.action);
  });
