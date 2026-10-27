import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the signal_broadcasts migration): posts
// any 90% gold or bitcoin scalp to the signals channel
// (signal-broadcast.server.ts). A {"ping": true} body posts a test line instead.
const PING_TEXT =
  "🏓 Ping test from OG B0T signals. If you can read this, the signals bot can post here. " +
  "Top scalp alerts will land in this channel.";

export const Route = createFileRoute("/api/public/signal-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });
        const { scanAndBroadcast, postToSignalsChannel, signalsChannelReady } =
          await import("@/lib/signal-broadcast.server");
        // Not set up yet: don't spend time building signals nobody will see.
        if (!signalsChannelReady()) return Response.json({ ok: true, skipped: "not_configured" });
        // Golden rule: if the target is a group OG B0T isn't in, the trade
        // bot doesn't post there (channels aren't groups, so they're fine).
        const { normaliseChannelId } = await import("@/lib/signal-broadcast.server");
        const target = normaliseChannelId(process.env.SIGNALS_CHANNEL_ID);
        if (target && /^-?\d+$/.test(target)) {
          const { managedGroup } = await import("@/lib/telegram-worker.server");
          const group = await managedGroup(supabaseAdmin, Number(target));
          if (group && group.chat_type !== "channel" && !group.og_bot_present)
            return Response.json({ ok: true, skipped: "gaffer_not_in_group" });
        }
        // {"ping": true}: a one-off test post, to check the bot and channel.
        const body = (await request.json().catch(() => null)) as { ping?: boolean } | null;
        if (body?.ping) {
          const messageId = await postToSignalsChannel(PING_TEXT);
          return Response.json({ ok: messageId !== null, ping: messageId !== null });
        }
        const { buildTradeSignal } = await import("@/lib/trade-signal-context.server");
        try {
          const result = await scanAndBroadcast(supabaseAdmin, {
            build: buildTradeSignal,
            post: postToSignalsChannel,
            follow: async (signal, messageId, card) => {
              if (!signal.plan || !target || !/^-\d+$/.test(target)) return;
              const { data: owner } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
              if (!owner) return;
              const { recordSignal } = await import("@/lib/trade-signal-tracker.server");
              await recordSignal({userId: owner.user_id, chatId: Number(target), messageId, card, plan: signal.plan as import("@/lib/trade-signal-context.server").SignalPlan, senderWorker: "trade"});
            },
            now: Date.now,
          });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[signals] scan failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
