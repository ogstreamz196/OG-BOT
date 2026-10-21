import { createFileRoute } from "@tanstack/react-router";
import { mapPool } from "@/lib/map-pool";

/** Telegram chat ids for these members, in one query. */
async function telegramChatIds(userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, telegram_chat_id")
    .in("id", ids);
  return new Map(
    (data ?? [])
      .filter((p) => p.telegram_chat_id != null)
      .map((p) => [p.id as string, Number(p.telegram_chat_id)]),
  );
}

export const Route = createFileRoute("/api/public/sports-guide-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });

        const { sendTelegramText } = await import("@/lib/sports-guide.server");
        const { data: due } = await supabaseAdmin
          .from("sports_guide_reminders")
          .select("id, user_id, post:sports_guide_posts(raw_text, event_time, telegram_message_id)")
          .is("sent_at", null)
          .lte("remind_at", new Date().toISOString())
          .limit(100);
        let sent = 0;
        const dueRows = due ?? [];
        if (dueRows.length) {
          // Claim them all in one go so overlapping runs never double-send.
          const { data: claimed } = await supabaseAdmin
            .from("sports_guide_reminders")
            .update({ sent_at: new Date().toISOString() })
            .in(
              "id",
              dueRows.map((r) => r.id),
            )
            .is("sent_at", null)
            .select("id");
          const claimedIds = new Set((claimed ?? []).map((c: { id: string }) => c.id));
          const mine = dueRows.filter((r) => claimedIds.has(r.id));
          const chatIds = await telegramChatIds(mine.map((r) => r.user_id as string));
          const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const results = await mapPool(mine, 10, async (r) => {
            const chatId = chatIds.get(r.user_id as string);
            const post = r.post as unknown as {
              raw_text: string;
              event_time: string | null;
            } | null;
            if (!chatId || !post) return false;
            const snippet = esc(
              post.raw_text.split("\n").filter(Boolean).slice(0, 4).join("\n").slice(0, 400),
            );
            return sendTelegramText(
              chatId,
              `🔔 <b>Match alert</b>${post.event_time ? ` · kick-off ${post.event_time}` : ""}\n\n${snippet}\n\n<a href="https://www.ogbot.co.uk/sports">Open Sports Guide</a>`,
            );
          });
          sent = results.filter(Boolean).length;
        }
        const { sweepDeletedSportsGuidePosts } = await import("@/lib/sports-guide.server");
        const removed = await sweepDeletedSportsGuidePosts().catch((e) => {
          console.error("[sports-guide] delete sweep failed", e);
          return 0;
        });
        // Self-destruct due OG Bot Telegram messages (Vault 1h, others ~48h).
        let expired = 0;
        try {
          const { data: dueMsgs } = await supabaseAdmin
            .from("telegram_ephemeral_messages" as never)
            .select("id, chat_id, message_id")
            .lte("delete_at", new Date().toISOString())
            .limit(200);
          const rows = (dueMsgs ?? []) as unknown as {
            id: string;
            chat_id: number;
            message_id: number;
          }[];
          const botToken = process.env.OG_BOT_TOKEN;
          if (botToken) {
            await mapPool(rows, 10, (m) =>
              fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: m.chat_id, message_id: m.message_id }),
              }).catch(() => null),
            );
          }
          // Drop the rows either way — already-cleared or too-old messages can't be deleted.
          if (rows.length) {
            await supabaseAdmin
              .from("telegram_ephemeral_messages" as never)
              .delete()
              .in(
                "id" as never,
                rows.map((m) => m.id),
              );
          }
          expired = rows.length;
        } catch (e) {
          console.error("[tg] ephemeral sweep failed", e);
        }
        // VIP ending reminders on Telegram: weekly from 1 month out, plus a final-day nudge, once each.
        let vipReminded = 0;
        try {
          const now = Date.now();
          const { data: vips } = await supabaseAdmin
            .from("user_roles")
            .select("user_id, expires_at")
            .eq("role", "vip")
            .not("expires_at", "is", null)
            .gt("expires_at", new Date(now).toISOString())
            .lte("expires_at", new Date(now + 30 * 86400_000).toISOString())
            .limit(200);
          const vipRows = vips ?? [];
          const vipChatIds = await telegramChatIds(vipRows.map((v) => v.user_id as string));
          const results = await mapPool(vipRows, 10, async (v) => {
            const left = new Date(v.expires_at as string).getTime() - now;
            const days = Math.ceil(left / 86400_000);
            const kind = days <= 1 ? "1d" : `w${Math.min(4, Math.ceil(days / 7))}`;
            const chatId = vipChatIds.get(v.user_id as string);
            if (!chatId) return false;
            const { error: dupe } = await supabaseAdmin
              .from("vip_expiry_reminders")
              .insert({ user_id: v.user_id, expires_at: v.expires_at as string, kind });
            if (dupe) return false; // already reminded
            const when = days <= 1 ? "tomorrow" : `in ${days} days`;
            return sendTelegramText(
              chatId,
              `👑 <b>Heads up, VIP</b>\n\nYour OG VIP ends ${when}. Renew now to keep every style, perk and priority cooking.\n\n<a href="https://www.ogbot.co.uk/store">Renew VIP</a>`,
            );
          });
          vipReminded = results.filter(Boolean).length;
        } catch (e) {
          console.error("[vip] expiry reminders failed", e);
        }
        return Response.json({ ok: true, sent, removed, expired, vipReminded });
      },
    },
  },
});
