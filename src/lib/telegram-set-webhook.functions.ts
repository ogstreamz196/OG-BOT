import { createServerFn } from "@tanstack/react-start";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const DEFAULT_WEBHOOK_URL =
  "https://ogbot.co.uk/api/public/telegram/webhook";

export type SetWebhookResult = {
  ok: boolean;
  url: string;
  description: string;
  botUsername: string | null;
};

function deriveSecret(key: string): string {
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}

/**
 * Admin one-click: (re)point Telegram at our webhook endpoint with the
 * derived secret. Use when /start in Telegram gets no reply — usually means
 * the active bot token isn't registered against our URL anymore.
 */
export const setTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): { url?: string } => {
    const d = (data ?? {}) as { url?: unknown };
    return { url: typeof d.url === "string" && d.url.length ? d.url : undefined };
  })
  .handler(async ({ context, data }): Promise<SetWebhookResult> => {
    const supabase = context.supabase as unknown as {
      rpc: (
        fn: "has_role",
        args: { _user_id: string; _role: "admin" },
      ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
    };
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const lovableKey = process.env.LOVABLE_API_KEY;
    const tgKey = process.env.TELEGRAM_API_KEY;
    if (!lovableKey || !tgKey) {
      throw new Error("Telegram connector not configured");
    }
    const url = data.url ?? DEFAULT_WEBHOOK_URL;
    const secret = deriveSecret(tgKey);

    const setRes = await fetch(`${GATEWAY_URL}/setWebhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        secret_token: secret,
        drop_pending_updates: true,
        allowed_updates: [
          "message",
          "edited_message",
          "channel_post",
          "edited_channel_post",
          "callback_query",
        ],
      }),
    });
    const setJson = (await setRes.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (!setRes.ok || setJson?.ok !== true) {
      throw new Error(setJson?.description ?? `setWebhook HTTP ${setRes.status}`);
    }

    // Identify the bot the token actually belongs to.
    let botUsername: string | null = null;
    try {
      const meRes = await fetch(`${GATEWAY_URL}/getMe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": tgKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const meJson = (await meRes.json().catch(() => null)) as {
        ok?: boolean;
        result?: { username?: string };
      } | null;
      botUsername = meJson?.result?.username ?? null;
    } catch {
      botUsername = null;
    }

    // Publish the "/" menu of commands for both regular users and admins.
    const publicCommands = [
      { command: "help", description: "Show menu" },
      { command: "balance", description: "Your OG coin balance" },
      { command: "library", description: "Open your song library" },
      { command: "vip", description: "Your VIP status and expiry" },
      { command: "vault", description: "Your OG Vault access ID" },
      { command: "sports", description: "Open the Sports Guide" },
      { command: "buy", description: "Top up OG coins" },
      { command: "me", description: "Your profile" },
    ];
    const adminCommands = [
      ...publicCommands,
      { command: "online", description: "Who's on site right now" },
      { command: "lastseen", description: "Recent visitors + last menu" },
      { command: "user", description: "Inspect a user by email/uuid" },
      { command: "users", description: "Search profiles" },
      { command: "stats", description: "Platform snapshot" },
      { command: "addcoins", description: "Grant OG coins" },
      { command: "broadcast", description: "DM every linked user" },
    ];
    const setCommands = async (scope: Record<string, unknown>, commands: unknown) => {
      await fetch(`${GATEWAY_URL}/setMyCommands`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": tgKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ commands, scope }),
      }).catch(() => undefined);
    };
    // Everyone (incl. all private DMs) sees only public commands.
    await setCommands({ type: "default" }, publicCommands);
    await setCommands({ type: "all_private_chats" }, publicCommands);
    // Admin commands are scoped to each boss's own Telegram chat only.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: roleRows } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin"]);
      const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id as string)));
      if (ids.length) {
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("telegram_chat_id")
          .in("id", ids)
          .not("telegram_chat_id", "is", null);
        for (const p of (profs ?? []) as { telegram_chat_id: number }[]) {
          await setCommands({ type: "chat", chat_id: p.telegram_chat_id }, adminCommands);
        }
      }
    } catch (e) {
      console.warn("[telegram] boss command scope failed", e);
    }

    return {
      ok: true,
      url,
      description: setJson?.description ?? "Webhook set",
      botUsername,
    };
  });
