import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** VIP-only: send a style / language / feature request straight to the Boss on Telegram. */
export const sendVipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["style", "language", "other"]),
        message: z.string().trim().min(3).max(800),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: isVipRole }, { data: isAdmin }, { data: prof }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "vip" as never }),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" as never }),
      supabase
        .from("profiles")
        .select("display_name, og_vip_id, telegram_username, vip_trial_ends_at")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    const p = prof as {
      display_name?: string | null;
      og_vip_id?: string | null;
      telegram_username?: string | null;
      vip_trial_ends_at?: string | null;
    } | null;
    const onTrial = !!p?.vip_trial_ends_at && new Date(p.vip_trial_ends_at).getTime() > Date.now();
    if (!isVipRole && !isAdmin && !onTrial) throw new Error("Requests are a VIP feature");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { vipAckTelegram } = await import("./vip-ack.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "boss"] as never);
    const ids = Array.from(new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id)));
    const { data: bosses } = ids.length
      ? await supabaseAdmin.from("profiles").select("telegram_chat_id").in("id", ids)
      : { data: [] };
    const chats = (bosses ?? [])
      .map((b: { telegram_chat_id: unknown }) => b.telegram_chat_id)
      .filter(Boolean);
    if (!chats.length) throw new Error("Boss Telegram isn't linked yet — try again later");

    const label = { style: "🎵 Style", language: "🌍 Language", other: "💡 Other" }[data.kind];
    const text =
      `<b>👑 VIP request — ${label}</b>\n` +
      `From: <b>${esc(p?.display_name ?? "Unknown")}</b>` +
      (p?.og_vip_id ? ` (<code>${esc(p.og_vip_id)}</code>)` : "") +
      (p?.telegram_username ? `\nTelegram: @${esc(p.telegram_username)}` : "") +
      `\n\n${esc(data.message)}`;
    const results = await Promise.all(
      chats.map((chat_id) => vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" })),
    );
    if (!results.some((r) => (r as { ok?: boolean } | null)?.ok)) {
      throw new Error("Couldn't reach the Boss right now — please try again");
    }
    return { ok: true };
  });
