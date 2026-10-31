import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectorFetch, connectorReady } from "@/lib/connectors.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function sendTg(chatId: number, text: string) {
  if (!connectorReady("telegram")) return;
  await connectorFetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => undefined);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Notify every admin's linked Telegram that a user just signed in.
 * Called once per session from the client.
 */
export const notifyDevSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Skip if caller is themselves an admin (we don't want to notify on dev's own logins)
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (isAdmin) return { ok: true, skipped: "self_admin" };

    // Find every admin user with a linked telegram chat
    const { data: adminRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRows ?? []).map((r) => r.user_id);
    if (adminIds.length === 0) return { ok: true, skipped: "no_admins" };

    const { data: targets } = await supabaseAdmin
      .from("profiles")
      .select("telegram_chat_id")
      .in("id", adminIds)
      .not("telegram_chat_id", "is", null);

    const when = new Date().toLocaleString("en-GB", { timeZone: "UTC" });
    const text =
      `🟢 <b>Sign-in</b>\n` +
      `Account <code>${escapeHtml(context.userId.slice(0, 8))}</code>\n` +
      `<i>${when} UTC</i>`;

    await Promise.all(
      (targets ?? [])
        .map((t) => t.telegram_chat_id)
        .filter((id): id is number => typeof id === "number")
        .map((id) => sendTg(id, text)),
    );

    return { ok: true, notified: targets?.length ?? 0 };
  });
