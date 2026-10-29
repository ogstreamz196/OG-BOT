import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the signal_broadcasts migration), and
// scanning again every 15 seconds through the minute: posts any top gold or
// bitcoin scalp to the signals channel, plus the hourly AI desk scout
// (signal-broadcast.server.ts). A {"ping": true} body posts a test line instead,
// and {"score": true} posts the OG Trade Bot's results.
const PING_TEXT =
  "🏓 Ping test from OG B0T signals. If you can read this, the signals bot can post here. " +
  "Scalp alerts will land in this channel.";

export const Route = createFileRoute("/api/public/signal-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });
        const { scanAndBroadcast, maybeDeskScout, postToSignalsChannel, signalsChannelReady } =
          await import("@/lib/signal-broadcast.server");
        // Not set up yet: don't spend time building signals nobody will see.
        if (!signalsChannelReady()) return Response.json({ ok: true, skipped: "not_configured" });
        // Golden rule: if the target is a group OG B0T isn't in, the trade
        // bot doesn't post there (channels aren't groups, so they're fine).
        // Saved as digits or an @name: either way, the chat's numeric id.
        const sc = await import("@/lib/signal-chat.server");
        const chatId = await sc.signalsChatId();
        if (chatId !== null) {
          const { managedGroup } = await import("@/lib/telegram-worker.server");
          const group = await managedGroup(supabaseAdmin, chatId);
          if (group && group.chat_type !== "channel" && !group.og_bot_present)
            return Response.json({ ok: true, skipped: "gaffer_not_in_group" });
        }
        // {"ping": true}: a one-off test post, to check the bot and channel.
        const body = (await request.json().catch(() => null)) as {
          ping?: boolean;
          score?: boolean;
        } | null;
        // {"score": true}: posts the results now and says how it went.
        if (body?.score) {
          const score =
            chatId === null
              ? "skipped: the trade bot can't find the signals chat"
              : await sc.refreshScore(supabaseAdmin, chatId);
          return Response.json({ ok: score === "posted", score });
        }
        if (body?.ping) {
          const messageId = await postToSignalsChannel(PING_TEXT);
          return Response.json({ ok: messageId !== null, ping: messageId !== null });
        }
        const { buildTradeSignal, deskRead } = await import("@/lib/trade-signal-context.server");
        const { repeatWithin } = await import("@/lib/repeat-within");
        type Follow = NonNullable<import("@/lib/signal-broadcast.server").ScanDeps["follow"]>;
        const follow: Follow = async (signal, messageId, card) => {
          if (!signal.plan || chatId === null) return;
          // Clutter free: this pair's older alert and its updates go.
          await sc.clearOlderPair(supabaseAdmin, chatId, signal.plan.market, messageId);
          await sc.trackSignalMessage(supabaseAdmin, chatId, messageId, signal.plan.market, "card");
          // The results go back to the bottom, under the new alert.
          await sc.refreshScore(supabaseAdmin, chatId);
          // The Boss's MT5 account takes the trade (when switched on).
          const { placeAutoTrade } = await import("@/lib/mt5-autotrade.server");
          await placeAutoTrade(
            supabaseAdmin,
            signal.plan as import("@/lib/trade-signal-context.server").SignalPlan,
          );
          const { data: owner } = await supabaseAdmin
            .from("user_roles")
            .select("user_id")
            .eq("role", "admin")
            .limit(1)
            .maybeSingle();
          if (!owner) return;
          const { recordSignal } = await import("@/lib/trade-signal-tracker.server");
          await recordSignal({
            userId: owner.user_id,
            chatId,
            messageId,
            card,
            plan: signal.plan as import("@/lib/trade-signal-context.server").SignalPlan,
            senderWorker: "trade",
          });
        };
        try {
          // Every 15 seconds through the minute, so a top setup goes out as
          // soon as it appears rather than at the next minute. Alongside it,
          // once an hour, the AI desk scouts both markets (posts only when
          // every AI agrees).
          const [passes, desk] = await Promise.all([
            repeatWithin(
              () =>
                scanAndBroadcast(supabaseAdmin, {
                  build: buildTradeSignal,
                  post: postToSignalsChannel,
                  follow,
                  now: Date.now,
                }),
              { everyMs: 15_000, lastStartMs: 30_000 },
            ),
            maybeDeskScout(supabaseAdmin, {
              read: deskRead,
              post: postToSignalsChannel,
              follow,
              now: Date.now,
            }),
          ]);
          const result = {
            checked: passes.reduce((n, p) => n + p.checked, 0),
            posted: passes.flatMap((p) => p.posted),
            passes: passes.length,
            desk,
          };
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[signals] scan failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
