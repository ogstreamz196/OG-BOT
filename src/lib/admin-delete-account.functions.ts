import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { data: isBoss, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    const { data: isAdmin, error: adminError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError || adminError || (!isBoss && !isAdmin)) throw new Error("Boss access required.");
    if (data.userId === context.userId) throw new Error("You cannot delete your own account here.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles, error: targetError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (targetError) throw targetError;
    if (targetRoles?.some(({ role }) => role === "boss" || role === "admin" || role === "dev")) {
      throw new Error("A privileged account cannot be deleted from this screen.");
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "delete_account",
      category: "users",
      target_key: data.userId,
      metadata: { deleted: true },
    });
    return { ok: true };
  });
