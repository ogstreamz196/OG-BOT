import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The app's instant "hold on" line for a trade-signal request: a line from
 * the shared bank this member has never seen. Returns null when the message
 * isn't a trade request.
 */
export const getTradeHoldLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z.object({ text: z.string().max(4000), tone: z.enum(["foul", "cheeky", "safe"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ line: string | null }> => {
    const { detectTradeIntent } = await import("@/lib/trade-signal");
    const market = detectTradeIntent(data.text);
    if (!market) return { line: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pickTradeHold } = await import("@/lib/trade-hold.server");
    // The page asks for a tone, but a foul line is only for members allowed
    // the foul mouth with it switched on (the same rule as the chat).
    let tone = data.tone;
    if (tone === "foul") {
      const [{ foulAccess }, { data: roleRows }] = await Promise.all([
        import("@/lib/foul-access.server"),
        supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      ]);
      const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
      if (!(await foulAccess(supabaseAdmin, context.userId, roles)).on) tone = "cheeky";
    }
    const line = await pickTradeHold(supabaseAdmin as never, context.userId, market, tone);
    return { line };
  });
