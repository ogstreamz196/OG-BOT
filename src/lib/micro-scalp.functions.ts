import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MicroRow } from "./micro-scalp";
import type { RapidRow } from "./rapid-scalp";

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

export type MicroLabView = {
  updatedAt: number | null;
  markets: { market: string; rows: MicroRow[]; rapid: RapidRow[] }[];
};

/** Boss: the HFT lab's scoreboard per market, best first. */
export const getMicroLab = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MicroLabView> => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadLab, loadRapid, MICRO_FEEDS } = await import("./micro-scalp.server");
    const { microBoard } = await import("./micro-scalp");
    const { rapidBoard } = await import("./rapid-scalp");
    const lab = await loadLab(supabaseAdmin);
    const rapid = await loadRapid(supabaseAdmin);
    return {
      updatedAt: lab.updatedAt ?? null,
      markets: Object.keys(MICRO_FEEDS).map((market) => ({
        market,
        rows: microBoard(lab.markets[market]),
        rapid: rapidBoard(rapid.markets[market]),
      })),
    };
  });
