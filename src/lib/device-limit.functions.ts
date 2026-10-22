import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const MAX_ACCOUNTS_PER_DEVICE = 2;

const deviceIdSchema = z.object({ deviceId: z.string().min(8).max(128) });

/**
 * A device is whitelisted from the 2-account rule once any account with an
 * admin/boss/dev role has signed in on it.
 */
export async function isDeviceWhitelisted(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  deviceId: string,
): Promise<boolean> {
  const { data: rows, error } = await supabaseAdmin
    .from("device_accounts")
    .select("user_id")
    .eq("device_id", deviceId);
  if (error) throw error;
  const userIds = (rows ?? []).map((r) => r.user_id);
  if (userIds.length === 0) return false;
  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .in("user_id", userIds)
    .in("role", ["admin", "boss", "dev"]);
  if (rolesError) throw rolesError;
  return (roles ?? []).length > 0;
}

/**
 * Public pre-signup check: is this device allowed to create another account?
 * Only returns a boolean/count — no user data — safe to expose.
 */
export const checkDeviceAccountAllowed = createServerFn({ method: "GET" })
  .validator((data) => deviceIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (await isDeviceWhitelisted(supabaseAdmin, data.deviceId)) {
      return { allowed: true, accounts: 0 };
    }
    const { count, error } = await supabaseAdmin
      .from("device_accounts")
      .select("id", { count: "exact", head: true })
      .eq("device_id", data.deviceId);
    if (error) throw error;
    const accounts = count ?? 0;
    return { allowed: accounts < MAX_ACCOUNTS_PER_DEVICE, accounts };
  });

/**
 * Authenticated: record that this device owns the signed-in account.
 * Returns whether this account is within the device allowance — callers use
 * it to withhold free-coin bonuses from extra accounts on the same device.
 */
export const registerDeviceAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => deviceIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("device_accounts")
      .upsert(
        { device_id: data.deviceId, user_id: context.userId },
        { onConflict: "device_id,user_id" },
      );
    // Devices the boss/admin has signed in on are whitelisted from the rule.
    if (await isDeviceWhitelisted(supabaseAdmin, data.deviceId)) {
      const { count } = await supabaseAdmin
        .from("device_accounts")
        .select("id", { count: "exact", head: true })
        .eq("device_id", data.deviceId);
      return { withinAllowance: true, accountsOnDevice: count ?? 0 };
    }
    const { data: rows, error } = await supabaseAdmin
      .from("device_accounts")
      .select("user_id")
      .eq("device_id", data.deviceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const users = (rows ?? []).map((r) => r.user_id);
    const withinAllowance = users.slice(0, MAX_ACCOUNTS_PER_DEVICE).includes(context.userId);
    return { withinAllowance, accountsOnDevice: users.length };
  });
