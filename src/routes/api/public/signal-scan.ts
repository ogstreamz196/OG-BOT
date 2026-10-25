import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the signal_broadcasts migration): posts
// any 90% gold or bitcoin scalp to the signals channel
// (signal-broadcast.server.ts). A {"ping": true} body posts a test line instead.
const PING_TEXT =
  "🏓 Ping test from OG B0T signals. If you can read this, the signals bot can post here. " +
  "90% scalp alerts will land in this channel.";

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
