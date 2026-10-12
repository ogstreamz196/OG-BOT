import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVipPassStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: purchase } = await supabaseAdmin
      .from("vip_pass_purchases")
      .select("credential_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    // The Vault is independent of VIP: bought (£10 / 50 coins), the 15-day signup trial, or Boss/admin.
    const [{ data: staff }, { data: prof }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .in("role", ["boss", "admin"])
        .limit(1),
      supabaseAdmin
        .from("profiles")
        .select("vip_trial_ends_at")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    const trialEnds = (prof as { vip_trial_ends_at?: string | null } | null)?.vip_trial_ends_at ?? null;
    const onTrial = !!trialEnds && new Date(trialEnds).getTime() > Date.now();
    const isStaff = (staff?.length ?? 0) > 0;
    let username: string | null = null;
    let password: string | null = null;
    const { data: creds } = await supabaseAdmin
      .from("vip_pass_credentials")
      .select("username,password")
      .eq("active", true)
      .order("created_at", { ascending: true });
    const available = creds?.length ?? 0;
    const owned = !!purchase || onTrial || isStaff;
    if (owned && creds && creds.length > 0) {
      const windowIndex = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
      const cred = creds[windowIndex % creds.length];
      username = cred.username;
      password = cred.password;
    }
    return {
      owned,
      purchased: !!purchase,
      trial: onTrial && !purchase && !isStaff,
      trialEndsAt: onTrial ? trialEnds : null,
      // kept for older callers: true while the free trial is what unlocks it
      vipFree: onTrial && !purchase && !isStaff,
      username,
      password,
      available,
    };
  });

export const purchaseVipPass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("purchase_vip_pass_for_user", {
      p_user: context.userId,
    });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; already_owned: boolean; username: string; password: string };
  });
