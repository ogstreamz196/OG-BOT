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

const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };

/**
 * Boss: the signals data room — the recent entries and the learning data, read
 * only. Nothing is ever deleted; reads limit themselves to a window. This is a
 * window onto the same tables the engine and the learning loop use.
 */
export const getDataRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { days: number } => {
    const n = Number((d as { days?: unknown } | null)?.days);
    return { days: [7, 30, 90].includes(n) ? n : 30 };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { learningState } = await import("./signal-learning.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const [entriesRes, sigCount, sampleCount, shadowCount, state] = await Promise.all([
      supabaseAdmin
        .from("trade_signals")
        .select(
          "id, market, label, direction, entry, stop, status, best_target, confidence_pct, timeframe, created_at, closed_at",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("trade_signals")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      supabaseAdmin.from("signal_learn_samples").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("signal_shadows").select("id", { count: "exact", head: true }),
      learningState(),
    ]);

    const learning = SIGNAL_MARKETS.map((code) => {
      const m = state.markets[code];
      return {
        market: code,
        label: MARKET_LABEL[code] ?? code,
        runs: m?.runs ?? 0,
        lastRunAt: m?.lastRunAt ?? null,
        lastChangeAt: m?.lastChangeAt ?? null,
        current: m?.current ?? null,
        lesson: m?.lesson ?? null,
      };
    });

    return {
      days: data.days,
      entries: (entriesRes.data ?? []) as DataRoomEntry[],
      counts: {
        entries: sigCount.count ?? 0,
        learnSamples: sampleCount.count ?? 0,
        shadows: shadowCount.count ?? 0,
      },
      learning,
    };
  });

export type DataRoomEntry = {
  id: string;
  market: string;
  label: string | null;
  direction: string;
  entry: number | null;
  stop: number | null;
  status: string;
  best_target: number | null;
  confidence_pct: number | null;
  timeframe: string | null;
  created_at: string;
  closed_at: string | null;
};
