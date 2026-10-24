/**
 * One Telegram Bot API call for jobs outside the webhook (same transport as
 * the webhook: the Boss's own bot token, or Lovable's Telegram connector).
 * Returns the API's `result`, or null on any failure.
 */
export async function telegramCall<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
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
    const payload = (await r.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
    return r.ok && payload?.ok ? (payload.result ?? null) : null;
  } catch {
    return null;
  }
}
