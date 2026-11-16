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
          maybeHedgeSignal,
          maybeRangeHedge,
          maybeAlongside,
          maybeReversalSignal,
          postToSignalsChannel,
          signalsChannelReady,
        } = await import("@/lib/signal-broadcast.server");
        // Every setup's fate this run, for the scan log (the switchboard's status).
        const { saveScanRun } = await import("@/lib/signal-scan-log.server");
        const notes: import("@/lib/signal-scan-log").ScanNote[] = [];
        const note = (n: import("@/lib/signal-scan-log").ScanNote) => void notes.push(n);
        // Not set up yet: don't spend time building signals nobody will see.
        if (!signalsChannelReady()) {
          await saveScanRun(supabaseAdmin, [], "the signals channel isn't set up");
          return Response.json({ ok: true, skipped: "not_configured" });
        }
        // Golden rule: if the target is a group OG B0T isn't in, the trade
        // bot doesn't post there (channels aren't groups, so they're fine).
        // Saved as digits or an @name: either way, the chat's numeric id.
        const sc = await import("@/lib/signal-chat.server");
        const chatId = await sc.signalsChatId();
        if (chatId !== null) {
          const { managedGroup } = await import("@/lib/telegram-worker.server");
          const group = await managedGroup(supabaseAdmin, chatId);
          if (group && group.chat_type !== "channel" && !group.og_bot_present) {
            await saveScanRun(supabaseAdmin, [], "OG B0T isn't in the signals group");
            return Response.json({ ok: true, skipped: "gaffer_not_in_group" });
          }
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
        // The switchboard (the Copy Trader B0T's card): posting off means no scan.
        const { engineConfig } = await import("@/lib/engine-config.server");
        if (!(await engineConfig()).group.posting) {
          await saveScanRun(supabaseAdmin, [], "posting is switched off on the switchboard");
          return Response.json({ ok: true, skipped: "posting_off" });
        }
        const { repeatWithin } = await import("@/lib/repeat-within");
        const { deskRunsToday } = await import("@/lib/signal-ai-budget.server");
        const { buildScanDeps } = await import("@/lib/signal-scan.server");
        // The scan deps, built once here and reused by the Boss's manual "send a
        // signal now" button (signal-scan.server.ts), so a hand-triggered signal
        // posts and is followed through the exact same path as an automatic one.
        const startedAt = Date.now();
        const { DESK_WINDOW_MS } = await import("@/lib/signal-scan.server");
        const deps = {
          ...(await buildScanDeps(supabaseAdmin, { chatId, startedAt })),
          note,
          deskUntil: startedAt + DESK_WINDOW_MS,
        };
        try {
          // Every 10 seconds through the minute, so a top setup goes out as
          // soon as it appears rather than at the next minute. Alongside it,
          // every 10 minutes, the AI desk scouts both markets (posts only when
          // every AI agrees), and a random strategy fires every 10–25 minutes.
          const [passes, desk, random, hedges, rangeHedges, alongside, reversals] =
            await Promise.all([
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
                note,
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
                note,
              }),
              // Counter-trend hedges against running trades (Boss switch "hedges", off by default).
              maybeHedgeSignal(supabaseAdmin, {
                build: deps.build,
                paper: deps.paper,
                gate: deps.gate,
                shadow: deps.shadow,
                post: deps.post,
                follow: deps.follow,
                now: deps.now,
                note,
              }),
              // Range hedges at both edges of a ranging market (Boss switch "rangeHedge", off by default).
              maybeRangeHedge(supabaseAdmin, {
                build: deps.build,
                paper: deps.paper,
                gate: deps.gate,
                shadow: deps.shadow,
                post: deps.post,
                follow: deps.follow,
                now: deps.now,
                note,
              }),
              // Proven patterns beside the engine's own trades (Boss switch "patternsAlongside", off by default).
              maybeAlongside(supabaseAdmin, {
                build: deps.build,
                paper: deps.paper,
                gate: deps.gate,
                shadow: deps.shadow,
                post: deps.post,
                follow: deps.follow,
                now: deps.now,
                note,
              }),
              // Quick reversal trades on either side (high-frequency mode only).
              maybeReversalSignal(supabaseAdmin, {
                build: deps.build,
                paper: deps.paper,
                gate: deps.gate,
                shadow: deps.shadow,
                post: deps.post,
                follow: deps.follow,
                now: deps.now,
                note,
              }),
              // High-frequency mode (the copier card's switch): the hedge, range,
              // alongside and reversal steps look again 20 and 40 seconds in,
              // each still behind its own switch.
              (async () => {
                const { hftOn } = await import("@/lib/copy-mirror.server");
                if (!(await hftOn())) return;
                const stepDeps = {
                  build: deps.build,
                  paper: deps.paper,
                  gate: deps.gate,
                  shadow: deps.shadow,
                  post: deps.post,
                  follow: deps.follow,
                  now: deps.now,
                  note,
                };
                for (let i = 0; i < 2; i++) {
                  await new Promise((r) => setTimeout(r, 20_000));
                  await Promise.all([
                    maybeHedgeSignal(supabaseAdmin, stepDeps),
                    maybeRangeHedge(supabaseAdmin, stepDeps),
                    maybeAlongside(supabaseAdmin, stepDeps),
                    maybeReversalSignal(supabaseAdmin, stepDeps),
                  ]);
                }
              })().catch(() => undefined),
            ]);
          await saveScanRun(supabaseAdmin, notes);
          const result = {
            checked: passes.reduce((n, p) => n + p.checked, 0),
            posted: passes.flatMap((p) => p.posted),
            passes: passes.length,
            desk,
            random,
            hedges,
            rangeHedges,
            alongside,
            reversals,
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
