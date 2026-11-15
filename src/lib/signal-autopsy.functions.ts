import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AutopsyRow } from "./signal-autopsy";

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

export type AutopsyView = { studied: number; updatedAt: number | null; rows: AutopsyRow[] };

/** Boss: why the losing signals lost, per market and strategy, with the lesson. */
export const getAutopsy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutopsyView> => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadAutopsy } = await import("./signal-autopsy.server");
    const { autopsyBoard } = await import("./signal-autopsy");
    const s = await loadAutopsy(supabaseAdmin);
    return { studied: s.studied, updatedAt: s.updatedAt ?? null, rows: autopsyBoard(s) };
  });
