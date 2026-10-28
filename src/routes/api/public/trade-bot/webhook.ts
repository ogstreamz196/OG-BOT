import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Webhook for the OG Trade Bot (SIGNALS_BOT_TOKEN), OG B0T's "chart slave"
// worker (see telegram-worker.server.ts). In a private chat it's a trading
// sidekick: trade asks get the code-built card, anything else the AI chat.
// In a group it only works while the Gaffer (OG B0T) is in the room and it's
// switched on there: OG B0T takes the signal asks and the insults, so the
// trade bot only answers people talking to it directly about something else.

const TRADE_BIAS = `
You are replying as the OG TRADE BOT, OG B0T's chart slave on Telegram. OG B0T is the Gaffer and you know it.
Keep the OG B0T persona and site knowledge, but lean every chat toward markets:
gold (XAU), bitcoin, forex, indices, scalps, timeframes, risk management.
Never invent prices or levels: tell them to ask "BTC scalp" or "gold signal" for a live signal.
Signals are indicator agreement, never a win rate and never financial advice. Never write @handles.`;

function safeEqual(a: string, b: string): boolean {
  const la = Buffer.from(a);
  const lb = Buffer.from(b);
  return la.length === lb.length && timingSafeEqual(la, lb);
}

type Chat = { id?: number; type?: string; title?: string };
type Msg = {
  message_id?: number;
  chat?: Chat;
  text?: string;
  from?: { is_bot?: boolean };
  reply_to_message?: { from?: { is_bot?: boolean; username?: string } };
  message_thread_id?: number;
  is_topic_message?: boolean;
};

export const Route = createFileRoute("/api/public/trade-bot/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.SIGNALS_BOT_TOKEN;
        if (!token) return new Response("Not configured", { status: 503 });
        const w = await import("@/lib/telegram-worker.server");
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, w.tradeBotSecret(token))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const update = (await request.json().catch(() => null)) as {
          message?: Msg;
          my_chat_member?: { chat?: Chat; new_chat_member?: { status?: string } };
        } | null;
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const say = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
          w.workerApi("sendMessage", {
            chat_id,
            text: text.slice(0, 4000),
            disable_web_page_preview: true,
            ...extra,
          });

        // Added to a group: stays only if the Gaffer's there.
        const joined = update?.my_chat_member;
        if (joined?.chat?.id && joined.chat.type !== "private" && joined.chat.type !== "channel") {
          const inChat = ["member", "administrator"].includes(joined.new_chat_member?.status ?? "");
          if (inChat && !(await w.managedGroup(admin, joined.chat.id))?.og_bot_present) {
            await say(joined.chat.id, w.WORKER_REFUSAL);
            await w.workerApi("leaveChat", { chat_id: joined.chat.id });
          }
          return Response.json({ ok: true });
        }

        const msg = update?.message;
        const chatId = msg?.chat?.id;
        const text = (msg?.text ?? "").trim().slice(0, 2000);
        if (!chatId || !msg) return Response.json({ ok: true });

        const inGroup = msg.chat?.type === "group" || msg.chat?.type === "supergroup";
        if (inGroup) {
          const group = await w.managedGroup(admin, chatId);
          // Golden rule: no Gaffer, no work.
          if (!group?.og_bot_present) {
            await say(chatId, w.WORKER_REFUSAL);
            await w.workerApi("leaveChat", { chat_id: chatId });
            return Response.json({ ok: true, left: "no_gaffer" });
          }
          // Switched off here by the Boss: say nothing.
          if (!(group.active_workers ?? []).includes("trade")) return Response.json({ ok: true });
          if (!text || msg.from?.is_bot) return Response.json({ ok: true });
          // Only people talking to it directly; signal asks and insults are
          // OG B0T's (it orders the card or steps in), so it stays out of those.
          const me = /og_?trade_?bot/i;
          const toMe =
            (!!msg.reply_to_message?.from?.is_bot &&
              me.test(msg.reply_to_message.from.username ?? "")) ||
            /@og_?trade_?bot\b/i.test(text);
          const { resolveTradeRequest, isAnyMarketAsk } = await import("@/lib/trade-signal");
          if (
            !toMe ||
            w.looksLikeInsult(text) ||
            resolveTradeRequest(text, []) ||
            isAnyMarketAsk(text)
          )
            return Response.json({ ok: true });
        } else if (msg.chat?.type !== "private") {
          return Response.json({ ok: true });
        }
        if (!text) return Response.json({ ok: true });
        const threaded = inGroup
          ? {
              reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
              ...(msg.is_topic_message ? { message_thread_id: msg.message_thread_id } : {}),
            }
          : {};

        if (text.startsWith("/start")) {
          await say(
            chatId,
            'OG Trade Bot here, the Gaffer\'s chart slave 📈 Ask me for a signal like "BTC scalp", "gold signal" or "EURUSD swing", or just chat markets. Not financial advice.',
          );
          return Response.json({ ok: true });
        }

        await w.workerApi("sendChatAction", { chat_id: chatId, action: "typing" });
        try {
          const { deskSignal, bestMarketAsk, cardToSend, plainForTelegram } =
            await import("@/lib/trade-signal-context.server");
          const { isAnyMarketAsk } = await import("@/lib/trade-signal");
          // In groups OG B0T handles signal asks; in a private chat they're ours.
          // No clean setup: the market-bias call instead of "no signal".
          const signal = inGroup
            ? { reply: "" }
            : cardToSend(await deskSignal(isAnyMarketAsk(text) ? await bestMarketAsk(text) : text));
          if (signal.reply) {
            await say(chatId, plainForTelegram(signal.reply), threaded);
            return Response.json({ ok: true });
          }
          const { buildSystemPrompt } = await import("@/lib/og-persona.server");
          const { fetchAiChat } = await import("@/lib/ai-endpoint.server");
          const system =
            buildSystemPrompt({
              mode: "og",
              foulMouth: true,
              bossScript: null,
              bossVoice: null,
              bossDictionary: null,
              user: {
                display_name: null,
                email: null,
                coin_balance: 0,
                is_admin: false,
                is_vip: false,
              },
            }) + TRADE_BIAS;
          const { response } = await fetchAiChat(
            {
              messages: [
                { role: "system", content: system },
                { role: "user", content: text },
              ],
            },
            "default",
            { foulMouth: true },
          );
          const json = (await response.json().catch(() => null)) as {
            choices?: { message?: { content?: string } }[];
          } | null;
          const answer = json?.choices?.[0]?.message?.content?.trim();
          await say(
            chatId,
            plainForTelegram(answer || "Markets got me busy, try again in a sec."),
            threaded,
          );
        } catch (e) {
          console.error("[trade-bot] reply failed", (e as Error).message);
          await say(chatId, "Bit of a glitch on my side, try again in a moment.", threaded);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
