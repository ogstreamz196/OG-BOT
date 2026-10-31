import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectorFetch, connectorReady } from "@/lib/connectors.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export type TelegramWebhookStatus = {
  ok: boolean;
  url: string | null;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  lastErrorDate: number | null;
  lastErrorMessage: string | null;
  lastSynchronizationErrorDate: number | null;
  maxConnections: number | null;
  allowedUpdates: string[] | null;
  ipAddress: string | null;
  checkedAt: string;
  error: string | null;
};

/** Admin: live Telegram getWebhookInfo probe via the connector gateway. */
export const getTelegramWebhookStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelegramWebhookStatus> => {
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

    const checkedAt = new Date().toISOString();
    const empty: TelegramWebhookStatus = {
      ok: false,
      url: null,
      hasCustomCertificate: false,
      pendingUpdateCount: 0,
      lastErrorDate: null,
      lastErrorMessage: null,
      lastSynchronizationErrorDate: null,
      maxConnections: null,
      allowedUpdates: null,
      ipAddress: null,
      checkedAt,
      error: null,
    };
    if (!connectorReady("telegram")) {
      return { ...empty, error: "Telegram connector not configured" };
    }

    try {
      const res = await connectorFetch(`${GATEWAY_URL}/getWebhookInfo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
        result?: {
          url?: string;
          has_custom_certificate?: boolean;
          pending_update_count?: number;
          last_error_date?: number;
          last_error_message?: string;
          last_synchronization_error_date?: number;
          max_connections?: number;
          allowed_updates?: string[];
          ip_address?: string;
        };
      } | null;

      if (!res.ok || body?.ok !== true || !body.result) {
        return {
          ...empty,
          error: body?.description ?? `HTTP ${res.status}`,
        };
      }
      const r = body.result;
      return {
        ok: true,
        url: r.url ?? null,
        hasCustomCertificate: !!r.has_custom_certificate,
        pendingUpdateCount: r.pending_update_count ?? 0,
        lastErrorDate: r.last_error_date ?? null,
        lastErrorMessage: r.last_error_message ?? null,
        lastSynchronizationErrorDate: r.last_synchronization_error_date ?? null,
        maxConnections: r.max_connections ?? null,
        allowedUpdates: r.allowed_updates ?? null,
        ipAddress: r.ip_address ?? null,
        checkedAt,
        error: null,
      };
    } catch (e) {
      return {
        ...empty,
        error: e instanceof Error ? e.message : "fetch failed",
      };
    }
  });
