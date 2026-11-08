import { createFileRoute } from "@tanstack/react-router";

// Called every minute by pg_cron (see the signal_broadcasts migration), and
// scanning again every 10 seconds through the minute: posts any top gold or
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
        const {
          scanAndBroadcast,
          maybeDeskScout,
          maybeRandomSignal,
          postToSignalsChannel,
          signalsChannelReady,
        } = await import("@/lib/signal-broadcast.server");
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
          freshStart?: boolean;
          demoStart?: boolean;
          balance?: number;
        } | null;
        // {"freshStart": true, "balance": 1000}: clears the signals chat,
        // restarts the record from zero and the test account at that balance,
        // and posts the Vantage invite and the test-mode note.
        if (body?.freshStart) {
          const start = Number(body.balance) > 0 ? Math.min(Number(body.balance), 1_000_000) : 1000;
          const { freshStart } = await import("@/lib/signals-fresh-start.server");
          return Response.json(await freshStart(supabaseAdmin, start));
        }
        // {"demoStart": true, "balance": 1000}: starts the demo account
        // without clearing anything; OG B0T announces it once.
        if (body?.demoStart) {
          const start = Number(body.balance) > 0 ? Math.min(Number(body.balance), 1_000_000) : 1000;
          const { demoStart } = await import("@/lib/signals-fresh-start.server");
          return Response.json(await demoStart(supabaseAdmin, start));
        }
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
        const { repeatWithin } = await import("@/lib/repeat-within");
        const { deskRunsToday } = await import("@/lib/signal-ai-budget.server");
        const { buildScanDeps } = await import("@/lib/signal-scan.server");
        // The scan deps, built once here and reused by the Boss's manual "send a
        // signal now" button (signal-scan.server.ts), so a hand-triggered signal
        // posts and is followed through the exact same path as an automatic one.
        const deps = await buildScanDeps(supabaseAdmin, { chatId, startedAt: Date.now() });
        try {
          // Every 10 seconds through the minute, so a top setup goes out as
          // soon as it appears rather than at the next minute. Alongside it,
          // every 10 minutes, the AI desk scouts both markets (posts only when
          // every AI agrees), and a random strategy fires every 10–25 minutes.
          const [passes, desk, random] = await Promise.all([
            repeatWithin(
              () =>
                scanAndBroadcast(supabaseAdmin, {
                  ...deps,
                  // Bitcoin and gold on the 1-minute, 5-minute, 15-minute and hourly charts.
                  frames: ["1m", "5m", "15m", "1h"],
                }),
              { everyMs: 10_000, lastStartMs: 40_000 },
            ),
            maybeDeskScout(supabaseAdmin, {
              read: deps.read,
              news: deps.news,
              paper: deps.paper,
              gate: deps.gate,
              shadow: deps.shadow,
              post: deps.post,
              follow: deps.follow,
              now: deps.now,
            }),
            maybeRandomSignal(supabaseAdmin, {
              build: deps.build,
              read: deps.read,
              paper: deps.paper,
              gate: deps.gate,
              shadow: deps.shadow,
              post: deps.post,
              follow: deps.follow,
              now: deps.now,
            }),
          ]);
          const result = {
            checked: passes.reduce((n, p) => n + p.checked, 0),
            posted: passes.flatMap((p) => p.posted),
            passes: passes.length,
            desk,
            random,
            aiRunsToday: await deskRunsToday(supabaseAdmin),
            alertBars: {
              BTCUSD: await deps.alertBar("BTCUSD"),
            },
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
