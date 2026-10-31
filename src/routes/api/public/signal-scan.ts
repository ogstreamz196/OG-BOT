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
          deskConfirmer,
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
        const { buildTradeSignal, deskRead, economicCalendar } =
          await import("@/lib/trade-signal-context.server");
        const { repeatWithin } = await import("@/lib/repeat-within");
        type Follow = NonNullable<import("@/lib/signal-broadcast.server").ScanDeps["follow"]>;
        const follow: Follow = async (signal, messageId, card) => {
          if (!signal.plan || chatId === null) return;
          // Timing, for the Boss's report: how long after the candle closed
          // it went out, and where price was by then.
          const { alertTiming } = await import("@/lib/signal-timing.server");
          const timing = await alertTiming(signal, Date.now()).catch(() => null);
          if (timing) signal.plan.feeds = { ...(signal.plan.feeds ?? {}), timing };
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
        // Every AI works with the chart engine: a 70%+ alert goes out only
        // when the AI desk backs it. The desk takes up to ~22s, so it's only
        // asked in the first 20s of this run (pg_cron gives the call 50s);
        // later finds wait for the next run, a minute away at most.
        const startedAt = Date.now();
        // Setups that aren't sent are followed silently for the Boss's report.
        const { recordShadow } = await import("@/lib/signal-shadows.server");
        // The AI desk's automatic runs come out of a daily budget, so more
        // trades never run the free AI keys dry; past it, the chart decides alone.
        const { takeDeskRun, deskRunsToday } = await import("@/lib/signal-ai-budget.server");
        const budgeted = async (ask: string, onlyWithSignal: boolean) => {
          const s = await buildTradeSignal(ask);
          if (onlyWithSignal && !s.plan) return { signal: s, desk: null };
          if (!(await takeDeskRun(supabaseAdmin))) return { signal: s, desk: null };
          return deskRead(ask, { onlyWithSignal });
        };
        const { alertBar } = await import("@/lib/signal-alert-bar.server");
        // The test account: every alert shows its balance and lot (0.1, or
        // 0.3 on an extremely confident quick scalp).
        type Built = Parameters<
          NonNullable<import("@/lib/signal-broadcast.server").ScanDeps["paper"]>
        >[0];
        const paper = async (s: Built): Promise<Built> => {
          const pa = await import("@/lib/paper-account.server");
          const state = await pa.paperState(supabaseAdmin);
          if (!state || !s.plan || !s.summary) return s;
          const balance = await pa.paperBalance(supabaseAdmin, state);
          const big = pa.bigOne({
            confidencePct: s.plan.confidencePct,
            timeframe: s.summary.timeframe,
            desk: String(s.plan.feeds?.desk ?? ""),
          });
          const lots = pa.paperLots(s.plan.market, s.plan.entry, s.summary.stop, balance, big);
          const { CARD_LOT } = await import("@/lib/trade-bias");
          return {
            ...s,
            reply: [
              pa.rescaleCardMoney(s.reply, CARD_LOT, lots),
              ...pa.paperLines(balance, lots, big),
            ].join("\n"),
            plan: { ...s.plan, feeds: { ...(s.plan.feeds ?? {}), paper: { lots, balance } } },
          };
        };
        const confirm = deskConfirmer(supabaseAdmin, (ask) => budgeted(ask, false), {
          now: Date.now,
          askUntil: startedAt + 20_000,
          onVeto: (s) => recordShadow(supabaseAdmin, s.summary, "desk_no"),
          // The desk's "no" can be learned off, like any other filter.
          skipDesk: async (market) => {
            const { relaxedFilters } = await import("@/lib/signal-filter-learning.server");
            return (await relaxedFilters(market)).has("desk_no");
          },
        });
        try {
          // Every 10 seconds through the minute, so a top setup goes out as
          // soon as it appears rather than at the next minute. Alongside it,
          // every 10 minutes, the AI desk scouts both markets (posts only when
          // every AI agrees).
          const [passes, desk] = await Promise.all([
            repeatWithin(
              () =>
                scanAndBroadcast(supabaseAdmin, {
                  build: buildTradeSignal,
                  // 15-minute scalps too: more setups, each still checked the same way.
                  frames: ["5m", "15m"],
                  // The alert bar comes down only where trades under it have been winning.
                  alertBar: (market) => alertBar(supabaseAdmin, market),
                  post: postToSignalsChannel,
                  follow,
                  confirm,
                  paper,
                  shadow: (s, why) => recordShadow(supabaseAdmin, s.summary, why),
                  now: Date.now,
                }),
              { everyMs: 10_000, lastStartMs: 40_000 },
            ),
            maybeDeskScout(supabaseAdmin, {
              // The AIs are only asked when the chart engine has a setup.
              read: (ask) => budgeted(ask, true),
              news: economicCalendar,
              paper,
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
            aiRunsToday: await deskRunsToday(supabaseAdmin),
            alertBars: {
              XAUUSD: await alertBar(supabaseAdmin, "XAUUSD"),
              BTCUSD: await alertBar(supabaseAdmin, "BTCUSD"),
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
