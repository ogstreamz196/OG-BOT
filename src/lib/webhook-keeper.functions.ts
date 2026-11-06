import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

/** Boss: the last webhook check (every 15 minutes, from the minute watcher). */
export const getWebhookChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const k = await import("./webhook-keeper.server");
    const { data } = await supabaseAdmin
      .from("site_content")
      .select("value")
      .eq("key", k.WEBHOOKS_KEY)
      .maybeSingle();
    return k.parseWebhookChecks((data as { value?: string } | null)?.value);
  });

/** Boss: check (and fix) every bot's webhook now. */
export const runWebhookCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const k = await import("./webhook-keeper.server");
    const checks = await k.checkWebhooks(supabaseAdmin);
    const at = new Date().toISOString();
    await supabaseAdmin
      .from("site_content")
      .upsert(
        { key: k.WEBHOOKS_KEY, value: JSON.stringify({ at, checks }), updated_at: at },
        { onConflict: "key" },
      );
    return { at, checks };
  });
