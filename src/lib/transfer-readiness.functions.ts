import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReadinessItem = {
  key: string;
  section: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
};

const has = (n: string) => Boolean(process.env[n] && String(process.env[n]).trim());

/** Transfer-specific checks only (no paid AI calls). API key pings live in the API hub. */
export const runTransferReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ checkedAt: string; items: ReadinessItem[] }> => {
    const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    if (!isAdmin) throw new Error("Forbidden");

    const items: ReadinessItem[] = [];
    const secret = (section: string, name: string, label: string, required = true) =>
      items.push({
        key: name,
        section,
        label,
        status: has(name) ? "ok" : required ? "fail" : "warn",
        detail: has(name) ? "Saved in the app's secure store." : "Not set.",
        fix: has(name) ? undefined : "Re-add it in Project Settings → Secrets after the move.",
      });

    secret("Payments", "STRIPE_SECRET_KEY", "Stripe card checkout key");
    secret("Payments", "PAYMENTS_LIVE_WEBHOOK_SECRET", "Live payment webhook secret", false);
    secret("Music", "SUNO_API_KEY", "Suno song generation");
    secret("Telegram", "OG_BOT_TOKEN", "OG Bot Telegram token");
    secret("Telegram", "TELEGRAM_API_KEY", "Telegram connector (workspace-linked)");
    secret("AI", "GEMINI_API_KEY", "Paid Gemini fallback and live web search", false);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vault } = await supabaseAdmin
      .from("vault_webhook_settings")
      .select("secret,last_test_ok,last_test_at")
      .eq("id", 1)
      .maybeSingle();
    items.push({
      key: "vault",
      section: "Vault API",
      label: "OG Vault API key",
      status: vault?.secret ? (vault.last_test_ok ? "ok" : "warn") : "fail",
      detail: vault?.secret
        ? `Key stored in the database (moves with the data).${vault.last_test_at ? ` Last ping ${new Date(vault.last_test_at).toLocaleString("en-GB")}.` : " Never pinged."}`
        : "No Vault API key created yet.",
      fix: vault?.secret ? undefined : "Create one in API & Integrations → OG Vault API.",
    });

    const counts = await Promise.all(
      (["profiles", "songs", "user_roles", "store_items"] as const).map(async (t) => {
        const { count } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
        return `${t.replace("_", " ")}: ${count ?? "?"}`;
      }),
    );
    items.push({
      key: "data",
      section: "Data",
      label: "Database snapshot",
      status: "ok",
      detail: counts.join(" · "),
      fix: "Note these numbers before moving and compare afterwards.",
    });

    items.push({
      key: "rc_ios",
      section: "Mobile billing",
      label: "RevenueCat iOS key",
      status: "warn",
      detail: "iOS still uses a test key, so iPhone purchases are not live yet.",
      fix: "Replace with the real iOS key from RevenueCat before the App Store launch.",
    });
    items.push({
      key: "rc_android",
      section: "Mobile billing",
      label: "RevenueCat Android key",
      status: "ok",
      detail: "Real Google Play key is built into the app (lives in code, moves with it).",
    });

    return { checkedAt: new Date().toISOString(), items };
  });
