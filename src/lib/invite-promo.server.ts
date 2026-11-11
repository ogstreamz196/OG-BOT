// Promotes the Boss's Vantage invite link: OG B0T recommends it when people
// ask about brokers (SITE_GLOSSARY in og-persona.server.ts), and the trade bot
// drops a short promo in the signals chat now and then (every 8 hours at
// most, UK daytime only, silently). Each new promo replaces the last, so the
// chat never fills up with them.
type Admin = any;

export const INVITE_LINK = "https://vigco.co/la-com-inv/TRADER2026";
const LAST_AT = "promo.invite.lastAt";
const LAST_MESSAGE = "promo.invite.lastMessage";
export const PROMO_EVERY_MS = 8 * 3600_000;

export const PROMO_LINES = [
  "💸 Still trading these signals on some shit broker? Open a Vantage account through the link below, same broker the Boss trades on.",
  "🚀 Want to take the signals properly? Get yourself a Vantage account below, tight spreads, fast fills, no excuses.",
  "📈 Copy the Boss, trade the alerts, stop watching from the sidelines like a muppet. Vantage account, link below.",
  "🔥 New here? Open your Vantage account through the button and you're trading the same setups the Boss takes.",
  "⏰ Reminder for the slow ones at the back: the broker the signals are built for is Vantage. Link below, sort it out.",
];

/** UK hour now (0–23). */
function ukHour(now: number): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now)),
  );
}

/** Whether a promo is due (pure, so it can be tested). */
export function promoDue(lastAt: string | null, now: number): boolean {
  const h = ukHour(now);
  if (h < 9 || h >= 21) return false;
  const last = lastAt ? Date.parse(lastAt) : NaN;
  return !Number.isFinite(last) || now - last >= PROMO_EVERY_MS;
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

async function save(admin: Admin, key: string, value: string) {
  await admin
    .from("site_content")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/**
 * Posts the invite promo in the signals chat when one is due. Says what
 * happened, for the watcher's response. Never throws.
 */
export async function maybePostPromo(admin: Admin, now = Date.now()): Promise<string> {
  try {
    if (!promoDue(await setting(admin, LAST_AT), now)) return "not due";
    const { signalsChannelReady } = await import("./signal-broadcast.server");
    if (!signalsChannelReady()) return "skipped: signals chat not set up";
    const { signalsChatId } = await import("./signal-chat.server");
    const chatId = await signalsChatId();
    if (chatId === null) return "skipped: signals chat not found";
    // Golden rule: the trade bot only works in a group while OG B0T is there.
    const { managedGroup, workerApi } = await import("./telegram-worker.server");
    const group = await managedGroup(admin, chatId);
    if (group && group.chat_type !== "channel" && !group.og_bot_present)
      return "skipped: gaffer not in group";
    // Claim the slot first, so two runs at once can't both post.
    await save(admin, LAST_AT, new Date(now).toISOString());
    const sent = await workerApi<{ message_id?: number }>("sendMessage", {
      chat_id: chatId,
      text: PROMO_LINES[Math.floor(Math.random() * PROMO_LINES.length)],
      disable_notification: true,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 Open your Vantage account", url: INVITE_LINK }]],
      },
    });
    const id = sent?.ok ? sent.result?.message_id : undefined;
    if (!id) return `failed: ${sent?.description ?? "no answer from Telegram"}`;
    const previous = Number(await setting(admin, LAST_MESSAGE));
    if (Number.isSafeInteger(previous) && previous > 0)
      await workerApi("deleteMessage", { chat_id: chatId, message_id: previous });
    await save(admin, LAST_MESSAGE, String(id));
    return "posted";
  } catch (e) {
    console.warn("[promo] invite promo failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}
