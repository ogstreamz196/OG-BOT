// Yearly VIP acknowledgement: queue a row and DM every Boss on Telegram with
// an "Acknowledge" button. Only the first insert notifies (idempotent).

import { escapeTelegramHtml as esc, telegramApi } from "./telegram-api.server";

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
    await telegramApi("sendMessage", {
      chat_id: b.telegram_chat_id,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}
