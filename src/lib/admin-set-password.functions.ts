import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Boss sets a new sign-in password for a member. Same guard rails as account
 * deletion: the role is checked on the server, Boss/admin/dev accounts are
 * protected, and the audit log records the action but never the password.
 */
export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        userId: z.string().uuid(),
        password: z
          .string()
          // Supabase still applies the project's own minimum length.
          .min(1, "Enter a password.")
          .max(72, "Password must be 72 characters or fewer."),
      })
      .parse(data),
  )
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
    if (data.userId === context.userId) {
      throw new Error("Change your own password from your account settings.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles, error: targetError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (targetError) throw targetError;
    if (targetRoles?.some(({ role }) => role === "boss" || role === "admin" || role === "dev")) {
      throw new Error("A privileged account's password cannot be changed from this screen.");
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "set_password",
      category: "users",
      target_key: data.userId,
      metadata: { password_changed: true },
    });
    return { ok: true };
  });
