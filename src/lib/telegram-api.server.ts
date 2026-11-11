export type TelegramReply<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

// Failures that are part of normal use (editing to the same text, deleting a
// message that is already gone) aren't worth a log line.
const QUIET_FAILURE =
  /message is not modified|message to delete not found|message can't be deleted/i;

/**
 * One Telegram Bot API call, used by the webhook and every job that messages
 * members: the Boss's own bot token when set, otherwise Lovable's Telegram
 * connector. Returns Telegram's reply (`ok` is false on API errors, and
 * `description` says why), or null when it couldn't be reached at all.
 */
export async function telegramApi<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramReply<T> | null> {
  const botToken = process.env.OG_BOT_TOKEN;
  const tgKey = process.env.TELEGRAM_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!botToken && (!tgKey || !lovableKey)) return null;
  const url = botToken
    ? `https://api.telegram.org/bot${botToken}/${method}`
    : `https://connector-gateway.lovable.dev/telegram/${method}`;
  const headers: Record<string, string> = botToken
    ? { "Content-Type": "application/json" }
    : {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey as string,
        "Content-Type": "application/json",
      };
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const payload = (await r.json().catch(() => null)) as Partial<TelegramReply<T>> | null;
    const ok = r.ok && payload?.ok !== false;
    if (!ok && !QUIET_FAILURE.test(payload?.description ?? "")) {
      console.error(
        `[telegram] ${method} failed [${r.status}]: ${payload?.description ?? "unknown error"}`,
      );
    }
    return { ...payload, ok };
  } catch {
    return null;
  }
}

/** Like telegramApi, but only the `result` of a successful call (else null). */
export async function telegramCall<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const res = await telegramApi<T>(method, body);
  return res?.ok ? (res.result ?? null) : null;
}

/** Makes text safe inside a Telegram HTML message. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
