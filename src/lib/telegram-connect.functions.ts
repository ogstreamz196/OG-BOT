import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * /tg-connect: links the Telegram account behind a one-time connect link to
 * the signed-in member (see telegram-connect.server.ts), then says so in their
 * Telegram chat.
 */
export const claimTelegramConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { token: string }) => ({ token: String(d?.token ?? "").slice(0, 64) }))
  .handler(async ({ data, context }) => {
    const claims = context.claims as { is_anonymous?: boolean } | undefined;
    if (claims?.is_anonymous) return { ok: false as const, reason: "signin" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimConnectToken } = await import("@/lib/telegram-connect.server");
    const result = await claimConnectToken(supabaseAdmin, context.userId, data.token);
    if (!result.ok) return result;
    try {
      const { telegramApi } = await import("@/lib/telegram-api.server");
      await telegramApi("sendMessage", {
        chat_id: result.telegramUserId,
        text: "✅ <b>Connected.</b> This Telegram is linked to your OG B0T account now. Get back in the group, or send /start here for your menu.",
        parse_mode: "HTML",
      });
    } catch {
      /* the link is done either way */
    }
    return { ok: true as const };
  });
