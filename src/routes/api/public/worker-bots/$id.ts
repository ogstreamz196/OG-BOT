import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/worker-bots/$id")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
        if (!key) return new Response("Not configured", { status: 503 });
        const f = await import("@/lib/telegram-fleet.server");
        if (
          !f.equalSecret(
            request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
            f.fleetSecret(params.id, key),
          )
        )
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { data: bot } = await admin
          .from("telegram_worker_bots")
          .select(`${f.FLEET_COLUMNS},created_by`)
          .eq("id", params.id)
          .eq("enabled", true)
          .maybeSingle();
        if (!bot) return Response.json({ ok: true });
        const update = (await request.json().catch(() => null)) as {
          update_id?: number;
          message?: {
            message_id: number;
            text?: string;
            chat: { id: number; type: string };
            from?: { is_bot?: boolean; first_name?: string };
            reply_to_message?: { from?: { id?: number } };
            message_thread_id?: number;
          };
          callback_query?: {
            id: string;
            from: { id: number };
            data?: string;
            message?: { message_id: number; chat: { id: number; type: string } };
          };
          my_chat_member?: {
            chat: { id: number; type: string };
            new_chat_member?: { status?: string };
          };
        } | null;
        if (!Number.isSafeInteger(update?.update_id))
          return new Response("Invalid update", { status: 400 });
        // A tap on the copy bot's settings card (Boss only): edit the card in place.
        const press = update?.callback_query;
        if (press) {
          if (bot.role === "copy" && press.data?.startsWith("cs:") && press.message) {
            const { error: dup } = await admin
              .from("telegram_worker_updates")
              .insert({ worker_id: bot.id, update_id: update?.update_id as number });
            if (dup) return Response.json({ ok: true });
            const { copySettingsTap } = await import("@/lib/copy-settings-bot.server");
            const res = await copySettingsTap(admin, press.from.id, press.data).catch(() => ({
              toast: "⚠️ Something went wrong. Try again.",
              panel: null,
            }));
            await f.fleetApi(
              bot.id,
              "answerCallbackQuery",
              { callback_query_id: press.id, text: res.toast.slice(0, 190) },
              key,
            );
            if (res.panel)
              await f.fleetApi(
                bot.id,
                "editMessageText",
                {
                  chat_id: press.message.chat.id,
                  message_id: press.message.message_id,
                  text: res.panel.text,
                  reply_markup: res.panel.reply_markup,
                },
                key,
              );
          } else {
            await f.fleetApi(bot.id, "answerCallbackQuery", { callback_query_id: press.id }, key);
          }
          return Response.json({ ok: true });
        }
        const joined = update?.my_chat_member;
        if (joined && joined.chat.type !== "private") {
          const { managedGroup, WORKER_REFUSAL } = await import("@/lib/telegram-worker.server");
          if (
            ["member", "administrator"].includes(joined.new_chat_member?.status ?? "") &&
            !(await managedGroup(admin, joined.chat.id))?.og_bot_present
          ) {
            await f.fleetApi(
              bot.id,
              "sendMessage",
              { chat_id: joined.chat.id, text: WORKER_REFUSAL },
              key,
            );
            await f.fleetApi(bot.id, "leaveChat", { chat_id: joined.chat.id }, key);
          }
          return Response.json({ ok: true });
        }
        const msg = update?.message;
        if (!msg?.text || msg.from?.is_bot) return Response.json({ ok: true });
        const group = msg.chat.type !== "private";
        if (group && !(await f.fleetAllowed(bot.id, msg.chat.id)))
          return Response.json({ ok: true });
        // In groups only the Gaffer dispatches tasks, preventing duplicate replies.
        if (group) return Response.json({ ok: true });
        const { error: claim } = await admin
          .from("telegram_worker_updates")
          .insert({ worker_id: bot.id, update_id: update?.update_id as number });
        if (claim) return Response.json({ ok: true });
        let reply = "";
        // Every bot's private chat carries the always-on "⚡ Generate BTC
        // Signal Now" button; a tap is a Bitcoin scalp, whichever bot it is.
        const { GENERATE_SIGNAL_KEYBOARD, isGenerateSignal, signalRequest } =
          await import("@/lib/telegram-signals");
        const tap = isGenerateSignal(msg.text);
        const ask = tap ? signalRequest("BTC", "5m") : msg.text.slice(0, 2000);
        if (tap && bot.role !== "trade") {
          // The copy bot and assistants: the chart engine's card (no AI).
          const { buildTradeSignal } = await import("@/lib/trade-signal-context.server");
          const s = await buildTradeSignal(ask).catch(() => null);
          const text =
            s?.reply || "📉 The charts aren't answering right now. Try again in a minute.";
          const sent = await f.fleetApi<{ message_id: number }>(
            bot.id,
            "sendMessage",
            { chat_id: msg.chat.id, text, reply_markup: GENERATE_SIGNAL_KEYBOARD },
            key,
          );
          if (s?.plan && sent.ok && sent.result) {
            const { recordSignal } = await import("@/lib/trade-signal-tracker.server");
            await recordSignal({
              userId: bot.created_by,
              chatId: msg.chat.id,
              messageId: sent.result.message_id,
              card: text,
              plan: {
                ...s.plan,
                feeds: {
                  ...s.plan.feeds,
                  requester: { id: msg.chat.id, name: msg.from?.first_name || "you" },
                },
              },
              senderWorker: bot.id,
            });
          }
          return Response.json({ ok: true });
        }
        if (bot.role === "trade") {
          const { deskSignal, cardToSend, plainForTelegram } =
            await import("@/lib/trade-signal-context.server");
          // No clean setup: the market-bias call instead of "no signal".
          const signal = cardToSend(await deskSignal(ask));
          reply = signal.reply
            ? plainForTelegram(signal.reply)
            : await f.assistantReply(bot, msg.text.slice(0, 2000));
          const sent = await f.fleetApi<{ message_id: number }>(
            bot.id,
            "sendMessage",
            { chat_id: msg.chat.id, text: reply, reply_markup: GENERATE_SIGNAL_KEYBOARD },
            key,
          );
          if (signal.plan && sent.ok && sent.result) {
            const { recordSignal } = await import("@/lib/trade-signal-tracker.server");
            await recordSignal({
              userId: bot.created_by,
              chatId: msg.chat.id,
              messageId: sent.result.message_id,
              card: reply,
              plan: {
                ...signal.plan,
                feeds: {
                  ...signal.plan.feeds,
                  requester: { id: msg.chat.id, name: msg.from?.first_name || "you" },
                },
              },
              senderWorker: bot.id,
            });
          }
        } else if (bot.role === "copy") {
          // The Boss's copier settings (/settings, /pause, /lot …), Boss only.
          if (!group) {
            const { copySettingsReply } = await import("@/lib/copy-settings-bot.server");
            const settings = await copySettingsReply(admin, msg.chat.id, msg.text).catch(
              () => null,
            );
            if (settings) {
              // On /start, the Boss's keyboard first (⚙️ Copier settings
              // beside the ⚡ signal button), then the settings card.
              if (/^\/start/i.test(msg.text.trim())) {
                const { bossKeyboard } = await import("@/lib/copy-settings-bot.server");
                const { GENERATE_SIGNAL_TEXT } = await import("@/lib/telegram-signals");
                await f.fleetApi(
                  bot.id,
                  "sendMessage",
                  {
                    chat_id: msg.chat.id,
                    text: "👋 Boss controls ready. Tap ⚙️ Copier settings any time.",
                    reply_markup: bossKeyboard(GENERATE_SIGNAL_TEXT),
                  },
                  key,
                );
              }
              await f.fleetApi(
                bot.id,
                "sendMessage",
                { chat_id: msg.chat.id, text: settings.text, reply_markup: settings.reply_markup },
                key,
              );
              return Response.json({ ok: true });
            }
          }
          // The copy-trade bot: how to copy the Boss's trades, with the link.
          const { copyBotReply } = await import("@/lib/mt5-autotrade.server");
          const copy = await copyBotReply(admin);
          await f.fleetApi(
            bot.id,
            "sendMessage",
            {
              chat_id: msg.chat.id,
              text: copy.text,
              // The copy link's button when there is one (a message has one
              // set of buttons); else the always-on signal button.
              reply_markup: copy.link
                ? { inline_keyboard: [[{ text: "📋 Copy my trades", url: copy.link }]] }
                : GENERATE_SIGNAL_KEYBOARD,
            },
            key,
          );
        } else {
          reply = await f.assistantReply(bot, msg.text.slice(0, 2000));
          await f.fleetApi(
            bot.id,
            "sendMessage",
            { chat_id: msg.chat.id, text: reply, reply_markup: GENERATE_SIGNAL_KEYBOARD },
            key,
          );
        }
        return Response.json({ ok: true });
      },
    },
  },
});
