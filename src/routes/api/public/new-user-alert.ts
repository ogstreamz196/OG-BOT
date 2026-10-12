import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Called by the database right after a new profile is created. Verifies the
// shared scheduler token, claims the profile once, then DMs every Boss/admin.
export const Route = createFileRoute("/api/public/new-user-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: ok } = await supabaseAdmin.rpc("verify_song_retry_token", { p_token: token });
        if (!ok) return new Response("Forbidden", { status: 403 });

        const parsed = z
          .object({ user_id: z.string().uuid() })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });

        // Atomic claim: only the first call for this user sends an alert.
        const { data: claimed } = await supabaseAdmin
          .from("profiles")
          .update({ boss_notified_at: new Date().toISOString() } as never)
          .eq("id", parsed.data.user_id)
          .is("boss_notified_at" as never, null)
          .select("display_name, created_at")
          .maybeSingle();
        if (!claimed) return Response.json({ ok: true, skipped: true });

        const { count } = await supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true });
        const { data: roleRows } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .in("role", ["admin", "boss"] as never);
        const ids = [...new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id))];
        const { data: bosses } = ids.length
          ? await supabaseAdmin.from("profiles").select("telegram_chat_id").in("id", ids)
          : { data: [] };
        const chats = [
          ...new Set(
            (bosses ?? []).map((b: { telegram_chat_id: unknown }) => b.telegram_chat_id).filter(Boolean),
          ),
        ];

        const name = (claimed as { display_name?: string | null }).display_name || "New member";
        const text =
          `<b>🎉 New OG BOT user</b>\n` +
          `Name: <b>${esc(name)}</b>\n` +
          `Joined: ${new Date().toUTCString()}` +
          (count ? `\nTotal members: <b>${count}</b>` : "");
        const { vipAckTelegram } = await import("@/lib/vip-ack.server");
        const results = await Promise.all(
          chats.map((chat_id) => vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" })),
        );
        const sent = results.filter((r) => (r as { ok?: boolean } | null)?.ok).length;
        if (!sent) {
          // Release the claim so a retry can still notify.
          await supabaseAdmin
            .from("profiles")
            .update({ boss_notified_at: null } as never)
            .eq("id", parsed.data.user_id);
          return Response.json({ ok: false, sent }, { status: 502 });
        }
        return Response.json({ ok: true, sent });
      },
    },
  },
});
