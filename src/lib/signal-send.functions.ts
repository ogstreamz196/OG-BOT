import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SIGNAL_MARKETS } from "./signal-markets";

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

const REASONS: Record<string, string> = {
  not_configured: "The signals chat isn't set up yet.",
  gaffer_not_in_group: "OG B0T isn't in that group, so it won't post there.",
  unknown_market: "That market isn't one the bot trades.",
};

/**
 * Boss: send a real signal for a market now. It runs the exact live scan for
 * that one market through the shared path (`runManualScan`): same gate,
 * concurrency, desk confirm, tracking and MT5/copy follow as the minute cron.
 * It only posts if a setup passes the gate right now; otherwise it posts
 * nothing and says so. The Copy Trader B0T copies anything that posts.
 */
export const sendSignalNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { market: string } => {
    const market = String((d as { market?: unknown } | null)?.market ?? "");
    if (!(SIGNAL_MARKETS as readonly string[]).includes(market)) throw new Error("Unknown market");
    return { market };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runManualScan } = await import("./signal-scan.server");
    const res = await runManualScan(supabaseAdmin, { market: data.market });
    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "send_signal_now",
      category: "signals",
      target_key: data.market,
      metadata: { posted: res.posted, checked: res.checked, reason: res.reason ?? null },
    });
    if (!res.ok) {
      return {
        ok: false as const,
        sent: false as const,
        message: REASONS[res.reason ?? ""] ?? "Couldn't send.",
      };
    }
    if (res.posted.length) {
      return { ok: true as const, sent: true as const, message: `Sent: ${res.posted.join(", ")}` };
    }
    return {
      ok: true as const,
      sent: false as const,
      message: "No setup passed the gate right now — nothing was sent. Try again shortly.",
    };
  });
