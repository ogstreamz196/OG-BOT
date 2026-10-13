import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DISS_TRACK_COST } from "@/lib/diss-ambush";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Charge the diss-track price once per attempt id (atomic, idempotent). */
export const chargeDissTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { attemptId: string }) => {
    if (!d || !UUID_RE.test(String(d.attemptId))) throw new Error("Bad attempt id");
    return { attemptId: String(d.attemptId) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("coin_balance")
      .eq("id", context.userId)
      .maybeSingle();
    if (Number(prof?.coin_balance ?? 0) < DISS_TRACK_COST)
      throw new Error(`Not enough coins — a diss track costs ${DISS_TRACK_COST}.`);
    const { error } = await (supabaseAdmin.rpc as unknown as Rpc)("deduct_coins", {
      p_user: context.userId,
      p_amount: DISS_TRACK_COST,
      p_reference: data.attemptId,
    });
    if (error) throw new Error(/insufficient/i.test(error.message) ? "Not enough coins." : "Couldn't take the coins, try again.");
    return { ok: true };
  });

/** Give the coins back if the track never started. Only refunds a real, un-refunded charge. */
export const refundDissTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { attemptId: string }) => {
    if (!d || !UUID_RE.test(String(d.attemptId))) throw new Error("Bad attempt id");
    return { attemptId: String(d.attemptId) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const refundRef = `diss_refund:${data.attemptId}`;
    const { data: rows } = await supabaseAdmin
      .from("coin_transactions")
      .select("reference, amount")
      .eq("user_id", context.userId)
      .in("reference", [data.attemptId, refundRef]);
    const charged = (rows ?? []).find((r) => r.reference === data.attemptId && Number(r.amount) < 0);
    const refunded = (rows ?? []).some((r) => r.reference === refundRef);
    if (!charged || refunded) return { refunded: false };
    const { error } = await (supabaseAdmin.rpc as unknown as Rpc)("credit_coin_transaction", {
      _user_id: context.userId,
      _amount: DISS_TRACK_COST,
      _type: "refund",
      _reference: refundRef,
    });
    if (error) throw new Error("Refund failed — message support.");
    return { refunded: true };
  });
