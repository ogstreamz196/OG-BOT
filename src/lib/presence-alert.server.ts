// Tells Boss/admin on Telegram that a member is online. Uses only the account
// name and the kind of activity (app opened / Battle Zone) — no pages, location
// or device data. A database cooldown stops repeat alerts. Members never get
// these: Battle Zone alerts to every linked member were too noisy.
import { cached } from "@/lib/server-cache";

const COOLDOWN_MIN = { app: 24 * 60, battle: 30 } as const;

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function alertBossPresence(userId: string, kind: "app" | "battle") {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Who the bosses are changes rarely; this runs on every battle post.
    const bossIds = await cached("boss-user-ids", 5 * 60_000, async () => {
      const { data: roleRows, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "boss"] as never);
      if (error) throw new Error(error.message);
      return [...new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id))];
    });
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
    const { telegramApi } = await import("@/lib/telegram-api.server");

    const text =
      kind === "battle"
        ? `<b>⚔️ ${name} is in Battle Zone</b>\n<a href="https://www.ogbot.co.uk/messenger">Jump in and have some fun!</a>`
        : `<b>🟢 ${name} just opened 0G B0T</b>`;
    const chats = [...new Set((bosses ?? []).map((b) => b.telegram_chat_id).filter(Boolean))];
    await Promise.all(
      chats.map((chat_id) => telegramApi("sendMessage", { chat_id, text, parse_mode: "HTML" })),
    );
  } catch (e) {
    console.error("presence alert failed", e);
  }
}
