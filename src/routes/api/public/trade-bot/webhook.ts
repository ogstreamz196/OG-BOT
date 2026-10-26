import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

// Webhook for the separate OG trade bot (SIGNALS_BOT_TOKEN). Same 0G B0T
// persona and site knowledge as the main bot, with a trading bias: trade asks
// get the code-built signal card; everything else goes to the AI chat.

const TRADE_BIAS = `
You are replying as the OG TRADE BOT, 0G B0T's trading sidekick on Telegram.
Keep the full 0G B0T persona and site knowledge, but lean every chat toward markets:
gold (XAU), bitcoin, forex, indices, scalps, timeframes, risk management.
Never invent prices or levels: tell them to ask "BTC scalp" or "XAU 15m signal" for a live signal.
Signals are indicator agreement, never a win rate and never financial advice.`;

export function tradeBotSecret(token: string): string {
  return createHash("sha256").update(`trade-bot-webhook:${token}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const la = Buffer.from(a);
  const lb = Buffer.from(b);
  return la.length === lb.length && timingSafeEqual(la, lb);
}

async function send(token: string, chat_id: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: text.slice(0, 4000), disable_web_page_preview: true }),
  }).catch(() => null);
}

async function typing(token: string, chat_id: number) {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, action: "typing" }),
  }).catch(() => null);
}

export const Route = createFileRoute("/api/public/trade-bot/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.SIGNALS_BOT_TOKEN;
        if (!token) return new Response("Not configured", { status: 503 });
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, tradeBotSecret(token))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const update = (await request.json().catch(() => null)) as {
          message?: { chat?: { id?: number; type?: string }; text?: string };
        } | null;
        const msg = update?.message;
        const chatId = msg?.chat?.id;
        const text = (msg?.text ?? "").trim().slice(0, 2000);
        if (!chatId || !text) return Response.json({ ok: true });

        if (text.startsWith("/start")) {
          await send(
            token,
            chatId,
            "Yo, OG Trade Bot here 📈 Ask me for a signal like \"BTC scalp\", \"XAU 15m\" or \"EURUSD swing\", or just chat markets. Not financial advice.",
          );
          return Response.json({ ok: true });
        }

        await typing(token, chatId);
        try {
          const { buildTradeSignal, plainForTelegram } = await import(
            "@/lib/trade-signal-context.server"
          );
          const signal = await buildTradeSignal(text);
          if (signal.reply) {
            await send(token, chatId, plainForTelegram(signal.reply));
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
          await send(token, chatId, plainForTelegram(answer || "Markets got me busy, try again in a sec."));
        } catch (e) {
          console.error("[trade-bot] reply failed", (e as Error).message);
          await send(token, chatId, "Bit of a glitch on my side, try again in a moment.");
        }
        return Response.json({ ok: true });
      },
    },
  },
});
