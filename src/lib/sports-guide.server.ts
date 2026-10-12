// Server-only helpers for Sports Guide reminders.
export async function sendTelegramText(chatId: number, html: string): Promise<boolean> {
  const botToken = process.env.OG_BOT_TOKEN;
  const tgKey = process.env.TELEGRAM_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const url = botToken
    ? `https://api.telegram.org/bot${botToken}/sendMessage`
    : "https://connector-gateway.lovable.dev/telegram/sendMessage";
  if (!botToken && (!tgKey || !lovableKey)) return false;
  const headers: Record<string, string> = botToken
    ? { "Content-Type": "application/json" }
    : {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey as string,
        "Content-Type": "application/json",
      };
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => null);
  if (!r) return false;
  const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
  return !!j?.ok;
}

/** London wall-clock "HH:MM" on/after the post date -> UTC instant. */
export function eventInstant(postedAtIso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const posted = new Date(postedAtIso);
  const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(posted);
  const build = (dateStr: string) => {
    // Interpret as London time by measuring the offset at that moment.
    const guess = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const londonHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(guess),
    );
    const offsetH = (londonHour - guess.getUTCHours() + 24) % 24;
    return new Date(guess.getTime() - offsetH * 3600_000);
  };
  let at = build(londonDate);
  if (at.getTime() < posted.getTime() - 3600_000) at = new Date(at.getTime() + 24 * 3600_000);
  return at;
}

/**
 * Telegram never notifies bots when a group message is deleted, so we probe:
 * silently forward recent guide posts to the Boss chat in one batch, then
 * delete the copies straight away. Any post Telegram can't forward is gone
 * from the source group, so we remove it from the feed too.
 */
export async function sweepDeletedSportsGuidePosts(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { vipAckTelegram: tg } = await import("@/lib/vip-ack.server");
  const { SPORTS_GUIDE_CHAT_ID } = await import("@/lib/sports-guide-parse");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "boss"] as never);
  const ids = [...new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))];
  if (!ids.length) return 0;
  const { data: profs } = await supabaseAdmin.from("profiles").select("telegram_chat_id").in("id", ids);
  const probeChat = (profs ?? []).map((p) => p.telegram_chat_id).find(Boolean);
  if (!probeChat) return 0;

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: posts } = await supabaseAdmin
    .from("sports_guide_posts")
    .select("id, telegram_message_id")
    .eq("chat_id", SPORTS_GUIDE_CHAT_ID)
    .gte("posted_at", since)
    .order("telegram_message_id", { ascending: true })
    .limit(100);
  if (!posts?.length) return 0;

  const msgIds = posts.map((p) => p.telegram_message_id);
  const res = (await tg("forwardMessages", {
    chat_id: probeChat,
    from_chat_id: SPORTS_GUIDE_CHAT_ID,
    message_ids: msgIds,
    disable_notification: true,
  })) as { ok?: boolean; result?: { message_id: number }[] } | null;
  if (!res?.ok || !Array.isArray(res.result)) return 0; // never delete on API errors
  const copies = res.result.map((m) => m.message_id);
  if (copies.length) await tg("deleteMessages", { chat_id: probeChat, message_ids: copies });

  // forwardMessages skips missing ids but keeps order; if every id came back, nothing was deleted.
  if (copies.length >= msgIds.length) return 0;
  // Identify which ids vanished by probing individually (rare path).
  const gone: string[] = [];
  for (const p of posts) {
    const one = (await tg("forwardMessage", {
      chat_id: probeChat,
      from_chat_id: SPORTS_GUIDE_CHAT_ID,
      message_id: p.telegram_message_id,
      disable_notification: true,
    })) as { ok?: boolean; result?: { message_id: number }; description?: string } | null;
    if (one?.ok && one.result) await tg("deleteMessage", { chat_id: probeChat, message_id: one.result.message_id });
    else if (/not found|can't be forwarded|MESSAGE_ID_INVALID/i.test(one?.description ?? "")) gone.push(p.id);
  }
  if (gone.length) await supabaseAdmin.from("sports_guide_posts").delete().in("id", gone);
  return gone.length;
}
