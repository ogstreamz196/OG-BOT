import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectorFetch, connectorReady } from "@/lib/connectors.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export type TelegramSmokeStep = {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
  url: string | null;
};

export type TelegramSmokeResult = {
  ok: boolean;
  ranAt: string;
  totalMs: number;
  steps: TelegramSmokeStep[];
};

async function callGateway(
  path: string,
): Promise<{ ok: boolean; status: number; body: any; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await connectorFetch(`${GATEWAY_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: { description: e instanceof Error ? e.message : "fetch failed" },
      latencyMs: Date.now() - start,
    };
  }
}

/** Admin: run full Telegram smoke test (getMe + getWebhookInfo) via the connector gateway. */
export const runTelegramSmokeTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelegramSmokeResult> => {
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

    const ranAt = new Date().toISOString();
    if (!connectorReady("telegram")) {
      return {
        ok: false,
        ranAt,
        totalMs: 0,
        steps: [
          {
            name: "Configuration",
            ok: false,
            latencyMs: 0,
            detail:
              "Telegram not configured (set OG_BOT_TOKEN, or LOVABLE_API_KEY and TELEGRAM_API_KEY)",
            url: null,
          },
        ],
      };
    }

    const start = Date.now();
    const steps: TelegramSmokeStep[] = [];

    // Step 1 — getMe
    const me = await callGateway("/getMe");
    const meOk = me.ok && me.body?.ok === true && !!me.body?.result?.id;
    steps.push({
      name: "Bot identity (getMe)",
      ok: meOk,
      latencyMs: me.latencyMs,
      detail: meOk
        ? `@${me.body.result.username} · id ${me.body.result.id} · ${me.body.result.first_name}`
        : (me.body?.description ?? `HTTP ${me.status}`),
      url: null,
    });

    // Step 2 — getWebhookInfo
    const wh = await callGateway("/getWebhookInfo");
    const whOk = wh.ok && wh.body?.ok === true && !!wh.body?.result;
    const r = wh.body?.result ?? {};
    const hasUrl = !!r.url;
    const delivering = whOk && hasUrl && !r.last_error_message;
    steps.push({
      name: "Webhook registration (getWebhookInfo)",
      ok: whOk && hasUrl,
      latencyMs: wh.latencyMs,
      detail: whOk
        ? hasUrl
          ? `URL set · ${r.pending_update_count ?? 0} pending · ip ${r.ip_address ?? "—"}`
          : "No webhook URL registered"
        : (wh.body?.description ?? `HTTP ${wh.status}`),
      url: whOk ? (r.url ?? null) : null,
    });

    // Step 3 — webhook delivery health (last_error_message)
    steps.push({
      name: "Webhook delivery health",
      ok: delivering,
      latencyMs: 0,
      detail: delivering
        ? "Telegram reports no recent delivery errors"
        : r.last_error_message
          ? `Last error${r.last_error_date ? ` at ${new Date(r.last_error_date * 1000).toISOString()}` : ""}: ${r.last_error_message}`
          : hasUrl
            ? "Webhook registered but not yet verified"
            : "Webhook not registered",
      url: null,
    });

    return {
      ok: steps.every((s) => s.ok),
      ranAt,
      totalMs: Date.now() - start,
      steps,
    };
  });
