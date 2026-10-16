import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_ACCOUNTS_PER_DEVICE } from "@/lib/device-limit.functions";

type BootstrapResult = {
  ensuredProfile: boolean;
  ensuredUserRole: boolean;
  ensuredBossRole: boolean;
  welcomeCoinsGranted: boolean;
};

const BOSS_EMAIL = "ogstreamz196@gmail.com";

export const ensureCurrentUserBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ deviceId: z.string().min(8).max(128).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<BootstrapResult> => {
    const { userId, claims } = context;
    // Guest (anonymous) sessions exist only to make one paid track on the
    // website: no device slot, welcome coins, roles or referral for them.
    if ((claims as Record<string, unknown>).is_anonymous === true) {
      return {
        ensuredProfile: false,
        ensuredUserRole: false,
        ensuredBossRole: false,
        welcomeCoinsGranted: false,
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = typeof claims.email === "string" ? claims.email : "";
    const userMetadata =
      typeof claims.user_metadata === "object" && claims.user_metadata
        ? (claims.user_metadata as Record<string, unknown>)
        : null;
    const displayName =
      userMetadata && typeof userMetadata.display_name === "string"
        ? userMetadata.display_name
        : (email.split("@")[0] ?? "User");

    let ensuredProfile = false;
    let ensuredUserRole = false;
    let ensuredBossRole = false;

    // Register this device and enforce the 2-accounts-per-device allowance.
    // Accounts beyond the allowance get a profile but no welcome coins.
    let withinDeviceAllowance = false;
    if (data.deviceId) {
      await supabaseAdmin
        .from("device_accounts")
        .upsert({ device_id: data.deviceId, user_id: userId }, { onConflict: "device_id,user_id" });
      const { isDeviceWhitelisted } = await import("@/lib/device-limit.functions");
      if (await isDeviceWhitelisted(supabaseAdmin, data.deviceId)) {
        withinDeviceAllowance = true;
      } else {
        const { data: deviceRows, error: deviceError } = await supabaseAdmin
          .from("device_accounts")
          .select("user_id")
          .eq("device_id", data.deviceId)
          .order("created_at", { ascending: true });
        if (deviceError) throw deviceError;
        withinDeviceAllowance = (deviceRows ?? [])
          .slice(0, MAX_ACCOUNTS_PER_DEVICE)
          .some((row) => row.user_id === userId);
      }
    }

    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!existingProfile) {
      const { error } = await supabaseAdmin.from("profiles").insert({
        id: userId,
        email,
        display_name: displayName || "User",
        coin_balance: 0,
      });
      if (error) throw error;
      ensuredProfile = true;
    }

    // Only the trusted, device-aware path can issue the one-time welcome reward.
    const eligibleForWelcome =
      Boolean(data.deviceId) && (withinDeviceAllowance || email.toLowerCase() === BOSS_EMAIL);
    const { data: welcomeResult, error: welcomeError } = await supabaseAdmin.rpc(
      "grant_welcome_bonus",
      { _user_id: userId, _eligible: eligibleForWelcome },
    );
    if (welcomeError) throw welcomeError;
    const welcomeCoinsGranted = Boolean((welcomeResult as { granted?: boolean } | null)?.granted);

    const { data: roleRows, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (rolesError) throw rolesError;

    const roles = new Set((roleRows ?? []).map((row) => row.role));

    if (!roles.has("user")) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "user" });
      if (error && error.code !== "23505") throw error;
      ensuredUserRole = true;
    }

    if (email.toLowerCase() === BOSS_EMAIL && !roles.has("admin")) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });
      if (error && error.code !== "23505") throw error;
      ensuredBossRole = true;
    }

    return { ensuredProfile, ensuredUserRole, ensuredBossRole, welcomeCoinsGranted };
  });
