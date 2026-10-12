import { createFileRoute } from "@tanstack/react-router";

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
        for (const r of due ?? []) {
          // Claim first so overlapping runs never double-send.
          const { data: claimed } = await supabaseAdmin
            .from("sports_guide_reminders")
            .update({ sent_at: new Date().toISOString() })
            .eq("id", r.id)
            .is("sent_at", null)
            .select("id");
          if (!claimed?.length) continue;
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("telegram_chat_id")
            .eq("id", r.user_id)
            .maybeSingle();
          const post = r.post as unknown as { raw_text: string; event_time: string | null } | null;
          if (!prof?.telegram_chat_id || !post) continue;
          const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const snippet = esc(post.raw_text.split("\n").filter(Boolean).slice(0, 4).join("\n").slice(0, 400));
          const okSend = await sendTelegramText(
            prof.telegram_chat_id,
            `🔔 <b>Match alert</b>${post.event_time ? ` · kick-off ${post.event_time}` : ""}\n\n${snippet}\n\n<a href="https://www.ogbot.co.uk/sports">Open Sports Guide</a>`,
          );
          if (okSend) sent++;
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
          const rows = (dueMsgs ?? []) as unknown as { id: string; chat_id: number; message_id: number }[];
          const botToken = process.env.OG_BOT_TOKEN;
          for (const m of rows) {
            if (botToken) {
              await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: m.chat_id, message_id: m.message_id }),
              }).catch(() => null);
            }
            // Drop the row either way — already-cleared or too-old messages can't be deleted.
            await supabaseAdmin.from("telegram_ephemeral_messages" as never).delete().eq("id", m.id);
            expired++;
          }
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
          for (const v of vips ?? []) {
            const left = new Date(v.expires_at as string).getTime() - now;
            const days = Math.ceil(left / 86400_000);
            const kind = days <= 1 ? "1d" : `w${Math.ceil(days / 7)}`;
            const { error: dupe } = await supabaseAdmin
              .from("vip_expiry_reminders")
              .insert({ user_id: v.user_id, expires_at: v.expires_at as string, kind });
            if (dupe) continue; // already reminded
            const { data: prof } = await supabaseAdmin
              .from("profiles")
              .select("telegram_chat_id")
              .eq("id", v.user_id)
              .maybeSingle();
            if (!prof?.telegram_chat_id) continue;
            const when = days <= 1 ? "tomorrow" : `in ${days} days`;
            const ok = await sendTelegramText(
              prof.telegram_chat_id,
              `👑 <b>Heads up, VIP</b>\n\nYour OG VIP ends ${when}. Renew now to keep every style, perk and priority cooking.\n\n<a href="https://www.ogbot.co.uk/store">Renew VIP</a>`,
            );
            if (ok) vipReminded++;
          }
        } catch (e) {
          console.error("[vip] expiry reminders failed", e);
        }
        return Response.json({ ok: true, sent, removed, expired, vipReminded });
      },
    },
  },
});
