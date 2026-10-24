import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the trade_signals migration): follows
// every live Telegram trade signal (trade-signal-tracker.server.ts).
export const Route = createFileRoute("/api/public/trade-signal-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });
        const { watchSignals } = await import("@/lib/trade-signal-tracker.server");
        try {
          return Response.json({ ok: true, ...(await watchSignals()) });
        } catch (e) {
          console.error("[signals] watch failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
