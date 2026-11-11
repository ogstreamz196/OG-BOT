import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Self-service account deletion (Google Play requirement). Privileged
// accounts are protected so a stolen session can't wipe the owner.
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ confirm: z.literal("DELETE") }).parse(data))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw roleErr;
    if (roles?.some(({ role }) => role === "boss" || role === "admin" || role === "dev")) {
      throw new Error("Staff accounts must be removed by the owner.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: null,
      action: "self_delete_account",
      category: "users",
      target_key: context.userId,
      metadata: { deleted: true },
    });
    return { ok: true };
  });
