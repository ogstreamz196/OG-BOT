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
          // The Copy Trader B0T takes over the tally as soon as it's set up.
          const { ensureCopyTally } = await import("@/lib/signal-chat.server");
          const copyTally = await ensureCopyTally(supabaseAdmin);
          // Step-by-step notes a Claude queued for a member's Telegram.
          const { sendTelegramNotes } = await import("@/lib/telegram-notes.server");
          const notes = await sendTelegramNotes(supabaseAdmin);
          // Every bot's Telegram webhook, checked every 15 minutes and put right.
          const { maybeKeepWebhooks } = await import("@/lib/webhook-keeper.server");
          const webhooks = await maybeKeepWebhooks(supabaseAdmin);
          // The Boss's MT5 trades: fills and closes (the copy bot announces them).
          const { followAutoTrades } = await import("@/lib/mt5-autotrade.server");
          const mt5 = await followAutoTrades(supabaseAdmin);
          // Now and then, the Boss's Vantage invite link in the signals chat.
          const { maybePostPromo } = await import("@/lib/invite-promo.server");
          const promo = await maybePostPromo(supabaseAdmin);
          // The Boss's MT5 account: the results post hides its balance once
          // the copier has been offline 10 minutes (and shows it again on return).
          const { syncResultsBalance } = await import("@/lib/mt5-account.server");
          const mt5Results = await syncResultsBalance(supabaseAdmin);
          // Vantage's spread, measured each minute (learning, the guard, hits on bid and ask).
          const { recordSpreads } = await import("@/lib/broker-quotes.server");
          const spreads = await recordSpreads(supabaseAdmin);
          // The setups that weren't sent, followed silently for the Boss's report.
          const { followShadows } = await import("@/lib/signal-shadows.server");
          const shadows = await followShadows(supabaseAdmin);
          // Signals chat quiet for an hour: OG B0T says it's bored, with a gold or BTC fact.
          const { maybeSignalsChatNudge } = await import("@/lib/og-idle-nudge.server");
          const idle = await maybeSignalsChatNudge(supabaseAdmin);
          // Cheeky banter in the Sports Guide group about games coming up / just gone.
          const { maybeSportsGroupBanter } = await import("@/lib/sports-group.server");
          const sportsBanter = await maybeSportsGroupBanter(supabaseAdmin);
          // Not busy (nothing to send this minute): study past signals and learn.
          const { maybeLearn } = await import("@/lib/signal-learning.server");
          const learning = events === 0 ? await maybeLearn(supabaseAdmin) : "busy";
          // The filters learn too: each one switches itself off or back on per
          // market from how the setups it blocked (or let through) did.
          const { maybeStudyFilters } = await import("@/lib/signal-filter-learning.server");
          const filters = events === 0 ? await maybeStudyFilters(supabaseAdmin) : "busy";
          return Response.json({
            ok: true,
            mt5Results,
            passes: passes.length,
            events,
            active: passes.at(-1)?.active ?? 0,
            copyTally,
            notes,
            webhooks,
            mt5,
            promo,
            idle,
            sportsBanter,
            learning,
            filters,
            spreads,
            shadows,
          });
        } catch (e) {
          console.error("[signals] watch failed", e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
