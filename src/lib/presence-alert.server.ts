// Tells Boss/admin on Telegram that a member is online. Uses only the account
// name and the kind of activity (app opened / Battle Zone) — no pages, location
// or device data. A database cooldown stops repeat alerts.
const COOLDOWN_MIN = { app: 24 * 60, battle: 30 } as const;

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function alertBossPresence(userId: string, kind: "app" | "battle") {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "boss"] as never);
    const bossIds = [...new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id))];
    if (!bossIds.length || bossIds.includes(userId)) return; // don't alert about yourself

    const { data: claimed } = await supabaseAdmin.rpc(
      "claim_presence_alert" as never,
      {
        p_user: userId,
        p_kind: kind,
        p_cooldown_minutes: COOLDOWN_MIN[kind],
      } as never,
    );
    if (!claimed) return;

    const [{ data: who }, { data: bosses }] = await Promise.all([
      supabaseAdmin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("profiles").select("telegram_chat_id").in("id", bossIds),
    ]);
    const name = esc(who?.display_name || "An OG member");
    const { vipAckTelegram } = await import("@/lib/vip-ack.server");

    if (kind === "battle") {
      // Battle Zone alerts go to every Telegram-linked member (not just Boss),
      // with a link straight into the Battle Zone so they can jump in.
      const text = `<b>⚔️ ${name} is in Battle Zone</b>\n<a href="https://www.ogbot.co.uk/messenger">Jump in and have some fun!</a>`;
      const { data: linked } = await supabaseAdmin
        .from("profiles")
        .select("telegram_chat_id")
        .not("telegram_chat_id", "is", null)
        .neq("id", userId);
      const chats = [...new Set((linked ?? []).map((p) => p.telegram_chat_id).filter(Boolean))];
      await Promise.all(
        chats.map((chat_id) =>
          vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" }),
        ),
      );
      return;
    }

    const text = `<b>🟢 ${name} just opened OG BOT</b>`;
    const chats = [...new Set((bosses ?? []).map((b) => b.telegram_chat_id).filter(Boolean))];
    await Promise.all(
      chats.map((chat_id) => vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" })),
    );
  } catch (e) {
    console.error("presence alert failed", e);
  }
}
