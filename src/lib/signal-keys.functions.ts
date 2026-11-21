import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BossKeyRow } from "./copier-keys.server";

// The Boss's OG SIGNAL BOT tokens in the Signals Control Room: every key,
// who it's paired with, and the actions (add days, off/on, clear the machine
// lock, remove, pair with an account). Boss only; tokens themselves are never
// sent (they're not stored).

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

export const listSignalKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BossKeyRow[] }> => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { bossKeyRows } = await import("./copier-keys.server");
    return { rows: await bossKeyRows(supabaseAdmin) };
  });

export const signalKeyAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().regex(/^[0-9a-f]{10}$/),
        action: z.enum(["extend", "off", "on", "reset", "remove"]),
        days: z.number().int().min(1).max(3650).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { bossKeyAction } = await import("./copier-keys.server");
    return bossKeyAction(supabaseAdmin, context.userId, data.id, data.action, data.days);
  });

export const pairSignalKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        who: z.string().trim().min(3).max(120),
        keyId: z
          .string()
          .regex(/^[0-9a-f]{10}$/)
          .optional(),
        days: z.number().int().min(1).max(3650).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { bossPairAccount } = await import("./copier-keys.server");
    return bossPairAccount(supabaseAdmin, context.userId, data.who, {
      keyId: data.keyId,
      days: data.days,
    });
  });
