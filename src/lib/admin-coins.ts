import { supabase } from "@/integrations/supabase/client";

/**
 * Boss coin adjustment that keeps the ledger honest. mint_coins_admin never
 * lets a balance go below 0 but records the amount it was asked for, so
 * taking away more than someone has would leave the ledger out of step.
 * Take-aways are capped at the current balance before the call; the ledger
 * row then matches exactly what moved. Returns the new balance and the
 * amount actually applied.
 */
export async function adjustCoinsAsBoss(
  userId: string,
  delta: number,
  notes: string,
): Promise<{ newBalance: number; applied: number }> {
  if (!Number.isFinite(delta) || Math.trunc(delta) === 0)
    throw new Error("Enter a non-zero amount");
  let applied = Math.trunc(delta);
  if (applied < 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("coin_balance")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const current = Math.max(0, Math.floor(Number(data?.coin_balance) || 0));
    if (current === 0) throw new Error("They already have 0 coins.");
    applied = Math.max(applied, -current);
  }
  const { data, error } = await supabase.rpc("mint_coins_admin", {
    target_user_id: userId,
    amount: applied,
    admin_notes: notes,
  });
  if (error) throw new Error(error.message);
  return { newBalance: data as number, applied };
}
