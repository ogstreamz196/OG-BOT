// Yearly VIP acknowledgement: queue a row and DM every Boss on Telegram with
// an "Acknowledge" button. Only the first insert notifies (idempotent).

async function tgCall(method: string, body: Record<string, unknown>) {
  const botToken = process.env.OG_BOT_TOKEN;
  const tgKey = process.env.TELEGRAM_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const direct = Boolean(botToken);
  if (!direct && (!tgKey || !lovableKey)) return null;
  const url = direct
    ? `https://api.telegram.org/bot${botToken}/${method}`
    : `https://connector-gateway.lovable.dev/telegram/${method}`;
  const headers: Record<string, string> = direct
    ? { "Content-Type": "application/json" }
    : {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey as string,
        "Content-Type": "application/json",
      };
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(
    () => null,
  );
  if (!r) return null;
  const j = (await r.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!r.ok || j?.ok === false) console.error(`[vip-ack] ${method} failed`, j?.description);
  return j;
}
export { tgCall as vipAckTelegram };

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function queueYearlyVipAck(admin: any, userId: string, ogVipId: string | null) {
  const { data: inserted, error } = await admin
    .from("vip_acknowledgements")
    .upsert(
      { user_id: userId, og_vip_id: ogVipId, plan: "yearly" },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select("user_id");
  if (error) {
    console.error("[vip-ack] insert failed", error.message);
    return;
  }
  if (!inserted || inserted.length === 0) return; // already queued → no duplicate DM

  const { data: member } = await admin
    .from("profiles")
    .select("display_name, telegram_username, telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();

  const { data: roleRows } = await admin
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "boss"]);
  const bossIds = Array.from(
    new Set(((roleRows ?? []) as { user_id: string }[]).map((r) => r.user_id)),
  );
  if (!bossIds.length) return;
  const { data: bosses } = await admin
    .from("profiles")
    .select("telegram_chat_id")
    .in("id", bossIds);

  const tgUser = member?.telegram_username as string | null;
  const text =
    `<b>👑 New OG VIP Yearly member!</b>\n` +
    `Name: <b>${esc(member?.display_name ?? "Unknown")}</b>\n` +
    `OG VIP ID: <code>${esc(ogVipId ?? "—")}</code>\n` +
    `Telegram: ${tgUser ? `@${esc(tgUser)}` : member?.telegram_chat_id ? "linked (no @username)" : "not linked"}`;

  const buttons: Array<Array<Record<string, string>>> = [
    [{ text: "✅ Acknowledge", callback_data: `vipack:${userId}` }],
  ];
  if (tgUser) buttons.push([{ text: `💬 Chat with @${tgUser}`, url: `https://t.me/${tgUser}` }]);
  else if (member?.telegram_chat_id)
    buttons.push([{ text: "💬 Chat with member", url: `tg://user?id=${member.telegram_chat_id}` }]);

  for (const b of (bosses ?? []) as { telegram_chat_id: number | null }[]) {
    if (!b.telegram_chat_id) continue;
    await tgCall("sendMessage", {
      chat_id: b.telegram_chat_id,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}
