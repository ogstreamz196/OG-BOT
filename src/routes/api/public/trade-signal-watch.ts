import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the trade_signals migration): follows
// every live Telegram trade signal (trade-signal-tracker.server.ts), checking
// again every 12 seconds through the minute.
export const Route = createFileRoute("/api/public/trade-signal-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });
        const { watchSignals } = await import("@/lib/trade-signal-tracker.server");
        const { repeatWithin } = await import("@/lib/repeat-within");
        try {
          // Every 12 seconds through the minute, so fills and profit hits go
          // out within seconds of price getting there.
          const passes = await repeatWithin(() => watchSignals(), {
            everyMs: 12_000,
            lastStartMs: 36_000,
          });
          const events = passes.reduce((n, p) => n + p.events, 0);
          // The Boss's MT5 trades: fills and closes (the copy bot announces them).
          const { followAutoTrades } = await import("@/lib/mt5-autotrade.server");
          const mt5 = await followAutoTrades(supabaseAdmin);
          // Now and then, the Boss's Vantage invite link in the signals chat.
          const { maybePostPromo } = await import("@/lib/invite-promo.server");
          const promo = await maybePostPromo(supabaseAdmin);
          return Response.json({
            ok: true,
            passes: passes.length,
            events,
            active: passes.at(-1)?.active ?? 0,
            mt5,
            promo,
          });
        } catch (e) {
          console.error("[signals] watch failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
