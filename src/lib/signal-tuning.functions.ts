import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SIGNAL_MARKETS } from "./signal-markets";
import { cleanTuningPatch } from "./trade-tweaker";
import type { Tuning } from "./trade-signal";

const MARKET_LABELS: Record<string, string> = {
  XAUUSD: "Gold (XAU/USD)",
  BTCUSD: "Bitcoin (BTC/USD)",
};

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

/**
 * Boss: TradeTweaker — every tunable knob, strategy and the learning data in
 * one place. Reads the learned state the engine already uses (no parallel
 * store). The per-market Tuning is editable (a seed the tuner may still move);
 * the engine-wide settings are shown read-only so nothing is hidden.
 */
export const getTweaker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { learningState, BOUNDS, safeTuning } = await import("./signal-learning.server");
    const { DEFAULT_TUNING, SESSIONS } = await import("./trade-signal");
    const { RETIRED_MARKETS } = await import("./signal-markets");
    const { POST_MIN_WINRATE, POST_MIN_WINRATE_TRADES, POST_MIN_CONFIDENCE, POST_MIN_RECORD } =
      await import("./signal-gate");
    const bc = await import("./signal-broadcast.server");
    const ex = await import("./trade-signal-outcome");
    const pc = await import("./pair-checks");

    const state = await learningState();
    const markets = SIGNAL_MARKETS.map((code) => {
      const m = state.markets[code];
      return {
        market: code,
        label: MARKET_LABELS[code] ?? code,
        tuning: safeTuning(m?.tuning ?? DEFAULT_TUNING),
        current: m?.current ?? null,
        lesson: m?.lesson ?? null,
        runs: m?.runs ?? 0,
        lastRunAt: m?.lastRunAt ?? null,
        lastChangeAt: m?.lastChangeAt ?? null,
        setups: m?.setups ?? null,
      };
    });

    const engine = {
      markets: { live: [...SIGNAL_MARKETS], retired: [...RETIRED_MARKETS] },
      gate: {
        minWinRate: POST_MIN_WINRATE,
        minWinRateTrades: POST_MIN_WINRATE_TRADES,
        minConfidence: POST_MIN_CONFIDENCE,
        minRecord: POST_MIN_RECORD,
      },
      concurrency: {
        free: bc.CONCURRENCY_FREE,
        step: bc.CONCURRENCY_STEP,
        barMax: bc.CONCURRENCY_BAR_MAX,
        perMarket: bc.MAX_RUNNING_PER_MARKET,
        sameSideGapMins: bc.SAME_SIDE_GAP_MS / 60_000,
        afterStopMins: bc.AFTER_STOP_MS / 60_000,
        sameSetupR: bc.SAME_SETUP_R,
      },
      exits: {
        profitLock: ex.PROFIT_LOCK,
        runner: ex.RUNNER,
        gainLock: ex.GAIN_LOCK,
        tpTrail: ex.TP_TRAIL,
      },
      checks: { bonus: pc.CHECK_BONUS, penalty: pc.CHECK_PENALTY, roundNearPct: pc.ROUND_NEAR_PCT },
    };

    return {
      markets,
      bounds: BOUNDS,
      defaults: DEFAULT_TUNING,
      engine,
      sessions: SESSIONS.map((s) => ({ id: s.id, name: s.name })),
    };
  });

/**
 * Boss: seed a market's Tuning. The patch is cleaned and merged over the
 * current setting, then run through safeTuning (the engine's own bounds), and
 * written back into the same learned state the signals read. The learning loop
 * is free to move it on its next run — this is a starting point, not a lock.
 */
export const saveTweaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { market: string; tuning: Partial<Tuning> } => {
    const market = String((d as { market?: unknown } | null)?.market ?? "");
    if (!(SIGNAL_MARKETS as readonly string[]).includes(market)) throw new Error("Unknown market");
    return { market, tuning: cleanTuningPatch((d as { tuning?: unknown } | null)?.tuning) };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parseLearning, LEARNING_KEY, safeTuning } = await import("./signal-learning.server");
    const { DEFAULT_TUNING } = await import("./trade-signal");
    const { forgetCached } = await import("./server-cache");

    const { data: row } = await supabaseAdmin
      .from("site_content")
      .select("value")
      .eq("key", LEARNING_KEY)
      .maybeSingle();
    const state = parseLearning((row as { value?: string } | null)?.value);
    const existing = state.markets[data.market];
    const base = existing?.tuning ?? DEFAULT_TUNING;
    const merged = safeTuning({ ...base, ...data.tuning });
    const now = new Date().toISOString();
    state.markets[data.market] = {
      ...(existing ?? { runs: 0, lastRunAt: now }),
      tuning: merged,
      lastChangeAt: now,
    };

    const { error } = await supabaseAdmin
      .from("site_content")
      .upsert(
        { key: LEARNING_KEY, value: JSON.stringify(state), updated_at: now },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    // So live signals pick up the seed without waiting for the 5-minute cache.
    forgetCached("signal-learning");

    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "tweak_signal_tuning",
      category: "signals",
      target_key: data.market,
      metadata: { keys: Object.keys(data.tuning), tuning: merged },
    });

    return { ok: true as const, market: data.market, tuning: merged };
  });
