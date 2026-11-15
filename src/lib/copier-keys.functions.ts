import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// A signed-in member's own copier (the /copier page): what the Boss gave
// them, whether it's running, and their own pause. Only ever their own key
// (looked up by their account id); the token and the stick are never sent.

export const getMyCopier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { myCopierFor } = await import("./copier-keys.server");
    return { copier: await myCopierFor(supabaseAdmin, context.userId).catch(() => null) };
  });

export const setMyCopierPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ paused: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setMyCopierPaused } = await import("./copier-keys.server");
    const copier = await setMyCopierPaused(supabaseAdmin, context.userId, data.paused).catch(
      () => null,
    );
    return { ok: !!copier, copier };
  });
