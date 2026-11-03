import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SIGNAL_MARKETS } from "./signal-markets";

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

const BOARD_DAYS = [7, 30, 60] as const;
export type BoardDays = (typeof BOARD_DAYS)[number];

/** Boss: each strategy's record (signal-random.server.ts), best first. Read only. */
export const getStrategyBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { days: BoardDays } => {
    const days = Number((d as { days?: unknown } | null)?.days);
    return { days: (BOARD_DAYS as readonly number[]).includes(days) ? (days as BoardDays) : 30 };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { strategyStats, STRATEGIES, STRATEGY_NAMES } = await import("./signal-random.server");
    const stats = await strategyStats(supabaseAdmin, Date.now(), data.days);
    const rows = STRATEGIES.filter((s) => stats[s]?.n).map((s) => {
      const x = stats[s]!;
      return {
        id: s,
        name: STRATEGY_NAMES[s],
        n: x.n,
        wins: x.wins,
        losses: x.losses,
        sumR: Math.round(x.sumR * 100) / 100,
        cash: x.cash ?? 0,
      };
    });
    rows.sort((a, b) => b.sumR - a.sumR);
    return { days: data.days, rows };
  });

/** Boss: the take profit signals use now against 1:1 and others, on stored setups. Read only. */
export const getTargetComparison = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { targetComparison } = await import("./signal-tp-compare.server");
    const { cached } = await import("./server-cache");
    // Replaying every stored setup six times is heavy: worked out at most every 15 minutes.
    return cached("signal-tp-compare", 15 * 60_000, async () => {
      const out = [];
      for (const market of SIGNAL_MARKETS) {
        const c = await targetComparison(supabaseAdmin, market).catch(() => null);
        if (c) out.push(c);
      }
      return out;
    });
  });
