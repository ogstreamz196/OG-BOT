import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const PERIODS = [7, 30, 90] as const;
export type ReportDays = (typeof PERIODS)[number];

/** Boss: where the signals' wins and losses come from (signal-report.server.ts). */
export const getSignalReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { days: ReportDays } => {
    const days = Number((d as { days?: unknown } | null)?.days);
    return { days: (PERIODS as readonly number[]).includes(days) ? (days as ReportDays) : 30 };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { signalReport } = await import("./signal-report.server");
    const { learningState } = await import("./signal-learning.server");
    const { filtersState, LEARNED_FILTERS } = await import("./signal-filter-learning.server");
    const { SHADOW_REASONS } = await import("./signal-shadows.server");
    const [report, learning, filterState] = await Promise.all([
      signalReport(supabaseAdmin, data.days),
      learningState().catch(() => null),
      filtersState(supabaseAdmin),
    ]);
    // Which filters each market has learned to switch off, and on what record.
    const filters = Object.fromEntries(
      ["XAUUSD", "BTCUSD"].map((market) => [
        market,
        LEARNED_FILTERS.map((f) => {
          const x = filterState.markets[market]?.[f];
          const rec = x?.relaxed ? x.live : x?.shadow;
          return {
            name: SHADOW_REASONS[f],
            relaxed: !!x?.relaxed,
            since: x?.since ?? null,
            wins: rec?.wins ?? 0,
            losses: rec?.losses ?? 0,
            net: rec?.net ?? 0,
          };
        }),
      ]),
    );
    // What the learning loop is using in each session right now.
    const sessions = Object.fromEntries(
      Object.entries(learning?.markets ?? {}).map(([market, m]) => [
        market,
        Object.entries(m.sessions ?? {}).map(([id, x]) => ({
          id,
          minConfidence: x!.tuning.minConfidence,
          stopRoom: x!.tuning.stopRoom,
          n: x!.n,
          winRate: x!.winRate,
        })),
      ]),
    );
    return { report, sessions, filters };
  });
