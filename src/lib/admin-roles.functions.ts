import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * One "Boss" level. The database still checks the older `admin` role in its
 * functions, so making someone Boss grants both `boss` and `admin`, and
 * removing Boss removes both. Caller must be Boss; you can't remove your own.
 */
export const setBossRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ userId: z.string().uuid(), makeBoss: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: isBoss }, { data: isAdmin }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    ]);
    if (!isBoss && !isAdmin) throw new Error("Boss access required.");
    if (!data.makeBoss && data.userId === context.userId) {
      throw new Error("You can't remove your own Boss access.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: target } = await db
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("User not found.");

    if (data.makeBoss) {
      const { error } = await db.from("user_roles").upsert(
        [
          { user_id: data.userId, role: "boss" },
          { user_id: data.userId, role: "admin" },
        ],
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .in("role", ["boss", "admin"]);
      if (error) throw new Error(error.message);
    }

    await db.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: data.makeBoss ? "grant_boss" : "revoke_boss",
      category: "users",
      target_key: data.userId,
      metadata: { roles: ["boss", "admin"] },
    });
    return { ok: true as const, isBoss: data.makeBoss };
  });
