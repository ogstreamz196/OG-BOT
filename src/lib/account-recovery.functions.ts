import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  handle: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(255),
  note: z.string().trim().max(300).optional(),
});

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Public: signed-out user asks the Boss to recover their account. Alerts Boss on Telegram. */
export const requestAccountRecovery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: roleRows } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "boss"] as never);
      const bossIds = [...new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id))];
      if (!bossIds.length) return { ok: true as const };
      const { data: bosses } = await supabaseAdmin
        .from("profiles")
        .select("telegram_chat_id")
        .in("id", bossIds);
      const chats = [...new Set((bosses ?? []).map((b) => b.telegram_chat_id).filter(Boolean))];
      const text =
        `<b>🚨 Account recovery request</b>\n` +
        `<b>Username:</b> ${esc(data.handle)}\n` +
        `<b>Send reset to:</b> ${esc(data.email)}\n` +
        (data.note ? `<b>Note:</b> ${esc(data.note)}\n` : "") +
        `<b>Time:</b> ${new Date().toUTCString()}\n` +
        `<a href="https://www.ogbot.co.uk/admin/users">Open Manage Users</a>`;
      const { vipAckTelegram } = await import("@/lib/vip-ack.server");
      await Promise.all(
        chats.map((chat_id) => vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" })),
      );
    } catch (e) {
      console.error("recovery alert failed", e);
    }
    return { ok: true as const };
  });
