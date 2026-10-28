import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** "Send to Telegram": posts one of your unlocked tracks to your linked Telegram chat. */
export const sendTrackToMyTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ songId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendTrackToTelegram } = await import("./telegram-track.server");
    const result = await sendTrackToTelegram(supabaseAdmin, context.userId, data.songId);
    return { result };
  });
