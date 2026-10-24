import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export type ChecklistStep = {
  id:
    | "secrets"
    | "bot_identity"
    | "webhook"
    | "personal_token"
    | "start_received"
    | "chat_verified";
  label: string;
  status: "ok" | "pending" | "failed";
  detail: string;
};

export type TelegramChecklistResult = {
  steps: ChecklistStep[];
  percent: number;
  ready: boolean;
  botUsername: string | null;
  webhookUrl: string | null;
  pendingUpdates: number | null;
  lastErrorMessage: string | null;
};

async function callTg(method: string, payload?: unknown) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) throw new Error("Telegram connector not configured");
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : "{}",
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: Record<string, unknown>;
    description?: string;
  } | null;
  return { res, body };
}

export const getMyTelegramChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelegramChecklistResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const steps: ChecklistStep[] = [];
    let botUsername: string | null = null;
    let webhookUrl: string | null = null;
    let pendingUpdates: number | null = null;
    let lastErrorMessage: string | null = null;

    // 1) Secrets present
    const hasSecrets = !!process.env.LOVABLE_API_KEY && !!process.env.TELEGRAM_API_KEY;
    steps.push({
      id: "secrets",
      label: "Connector secrets configured",
      status: hasSecrets ? "ok" : "failed",
      detail: hasSecrets
        ? "TELEGRAM_API_KEY + LOVABLE_API_KEY present."
        : "Missing TELEGRAM_API_KEY or LOVABLE_API_KEY in env.",
    });

    // 2) Bot identity (getMe)
    if (hasSecrets) {
      try {
        const { res, body } = await callTg("getMe");
        if (res.ok && body?.ok) {
          botUsername = (body.result as { username?: string })?.username ?? null;
          steps.push({
            id: "bot_identity",
            label: "OG B0T identity reachable",
            status: "ok",
            detail: botUsername ? `Bot @${botUsername} is online.` : "Bot reachable.",
          });
        } else {
          steps.push({
            id: "bot_identity",
            label: "OG B0T identity reachable",
            status: "failed",
            detail: body?.description ?? `HTTP ${res.status}`,
          });
        }
      } catch (e) {
        steps.push({
          id: "bot_identity",
          label: "OG B0T identity reachable",
          status: "failed",
          detail: e instanceof Error ? e.message : "getMe failed",
        });
      }

      // 3) Webhook registered + healthy
      try {
        const { res, body } = await callTg("getWebhookInfo");
        if (res.ok && body?.ok) {
          const info = body.result as {
            url?: string;
            pending_update_count?: number;
            last_error_message?: string;
          };
          webhookUrl = info?.url ?? null;
          pendingUpdates = info?.pending_update_count ?? 0;
          lastErrorMessage = info?.last_error_message ?? null;
          const healthy = !!webhookUrl && !lastErrorMessage;
          steps.push({
            id: "webhook",
            label: "Webhook delivering updates",
            status: healthy ? "ok" : webhookUrl ? "failed" : "pending",
            detail: webhookUrl
              ? lastErrorMessage
                ? `Last error: ${lastErrorMessage}`
                : `URL set · ${pendingUpdates ?? 0} pending`
              : "No webhook URL registered with Telegram.",
          });
        } else {
          steps.push({
            id: "webhook",
            label: "Webhook delivering updates",
            status: "failed",
            detail: body?.description ?? `HTTP ${res.status}`,
          });
        }
      } catch (e) {
        steps.push({
          id: "webhook",
          label: "Webhook delivering updates",
          status: "failed",
          detail: e instanceof Error ? e.message : "getWebhookInfo failed",
        });
      }
    }

    // 4) Personal token + chat link status
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("telegram_link_token, telegram_chat_id, telegram_username, telegram_linked_at")
      .eq("id", context.userId)
      .maybeSingle();

    steps.push({
      id: "personal_token",
      label: "Your personal start-link minted",
      status: profile?.telegram_link_token || profile?.telegram_chat_id ? "ok" : "pending",
      detail: profile?.telegram_link_token
        ? "Active token ready — open from Settings → Connect Telegram."
        : profile?.telegram_chat_id
          ? "Already linked, no fresh token needed."
          : "No active token. Rotate one from Settings.",
    });

    steps.push({
      id: "start_received",
      label: "Telegram /start received",
      status: profile?.telegram_chat_id ? "ok" : "pending",
      detail: profile?.telegram_chat_id
        ? `Captured chat_id${profile.telegram_username ? ` for @${profile.telegram_username}` : ""}.`
        : "Open the start-link in Telegram and tap Start.",
    });

    // 6) Live chat verification ping
    if (profile?.telegram_chat_id && hasSecrets) {
      try {
        const { res, body } = await callTg("getChat", {
          chat_id: profile.telegram_chat_id,
        });
        const ok =
          res.ok &&
          body?.ok === true &&
          Number((body.result as { id?: number })?.id) === Number(profile.telegram_chat_id);
        steps.push({
          id: "chat_verified",
          label: "OG B0T can reach your chat",
          status: ok ? "ok" : "failed",
          detail: ok
            ? `Verified${profile.telegram_linked_at ? ` since ${new Date(profile.telegram_linked_at).toLocaleString()}` : ""}.`
            : (body?.description ?? `HTTP ${res.status}`),
        });
      } catch (e) {
        steps.push({
          id: "chat_verified",
          label: "OG B0T can reach your chat",
          status: "failed",
          detail: e instanceof Error ? e.message : "getChat failed",
        });
      }
    } else {
      steps.push({
        id: "chat_verified",
        label: "OG B0T can reach your chat",
        status: "pending",
        detail: "Will run after linking finishes.",
      });
    }

    const okCount = steps.filter((s) => s.status === "ok").length;
    const percent = Math.round((okCount / steps.length) * 100);
    const ready = steps.every((s) => s.status === "ok");

    return {
      steps,
      percent,
      ready,
      botUsername,
      webhookUrl,
      pendingUpdates,
      lastErrorMessage,
    };
  });
