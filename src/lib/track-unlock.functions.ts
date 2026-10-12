import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Owner unlocks are atomic and include the paired take at no additional cost. */
export const purchaseOwnerTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ songId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: song } = await context.supabase.from("songs").select("user_id")
      .eq("id", data.songId).maybeSingle();
    if (!song || song.user_id !== context.userId) throw new Error("Track not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("purchase_owner_track", {
      p_user: context.userId, p_song: data.songId,
    });
    if (error) throw new Error(/insufficient_coins/i.test(error.message)
      ? "Not enough coins" : "Could not unlock this track. Please try again.");
    return result as { ok: boolean; already: boolean; cost: number; coin_balance: number; second_take: string | null };
  });