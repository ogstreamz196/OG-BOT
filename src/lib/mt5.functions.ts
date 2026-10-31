import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccountInfo } from "./mt5-autotrade.server";

async function assertBoss(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: string },
    ) => Promise<{ data: boolean | null }>;
  };
  const [admin, boss] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!admin.data && !boss.data) throw new Error("Forbidden");
}

/** Boss: MT5 auto-trading status, the live account and recent trades. */
export const getMt5Status = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const m = await import("./mt5-autotrade.server");
    const configured = m.metaApiConfigured();
    const bq = await import("./broker-quotes.server");
    const [autotrade, link, info, trades, commission, spreads] = await Promise.all([
      m.autotradeOn(supabaseAdmin),
      m.copyLink(supabaseAdmin),
      configured ? m.metaApi<AccountInfo>("/account-information") : null,
      (supabaseAdmin as any)
        .from(m.MT5_TABLE)
        .select(
          "id, label, symbol, direction, order_type, volume, entry, stop_loss, take_profit, status, error, profit, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(15),
      (supabaseAdmin as any)
        .from("site_content")
        .select("value")
        .eq("key", bq.COMMISSION_KEY)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("site_content")
        .select("value")
        .eq("key", bq.SPREADS_KEY)
        .maybeSingle(),
    ]);
    // Vantage's spread as the bot has measured it: the latest and the usual for now.
    const model = bq.parseSpreads((spreads.data as { value?: string } | null)?.value);
    const now = Date.now();
    const spread = Object.fromEntries(
      ["XAUUSD", "BTCUSD"].map((mk) => [
        mk,
        {
          latest: bq.latestSpread(model, mk, now),
          usual: bq.typicalSpread(model, mk, now),
          readings: model.markets[mk]?.overall?.n ?? 0,
        },
      ]),
    );
    return {
      configured,
      autotrade,
      copyLink: link,
      commissionPerLot: Number((commission.data as { value?: string } | null)?.value) || 0,
      spread,
      account: info?.ok && info.data ? info.data : null,
      accountError: configured && !info?.ok ? `MetaApi answered ${info?.status ?? 0}` : null,
      tradesReady: !trades.error,
      trades: (trades.data ?? []) as {
        id: string;
        label: string;
        symbol: string;
        direction: string;
        order_type: string;
        volume: number;
        entry: number;
        stop_loss: number;
        take_profit: number;
        status: string;
        error: string | null;
        profit: number | null;
        created_at: string;
      }[],
    };
  });

/** Boss: switch auto-trading on or off, and set the copy-trading link. */
export const saveMt5Settings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        autotrade: z.boolean().optional(),
        copyLink: z
          .string()
          .trim()
          .max(500)
          .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Use a full https:// link")
          .optional(),
        /** USD per 1.0 lot, round turn (0 on a Standard account). */
        commissionPerLot: z.number().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { AUTOTRADE_KEY, COPY_LINK_KEY } = await import("./mt5-autotrade.server");
    const db = supabaseAdmin as any;
    const at = new Date().toISOString();
    const rows: { key: string; value: string }[] = [];
    if (data.autotrade !== undefined)
      rows.push({ key: AUTOTRADE_KEY, value: data.autotrade ? "on" : "off" });
    if (data.copyLink !== undefined) rows.push({ key: COPY_LINK_KEY, value: data.copyLink });
    if (data.commissionPerLot !== undefined) {
      const { COMMISSION_KEY } = await import("./broker-quotes.server");
      rows.push({ key: COMMISSION_KEY, value: String(data.commissionPerLot) });
    }
    for (const r of rows) {
      const { error } = await db
        .from("site_content")
        .upsert({ ...r, updated_at: at, updated_by: context.userId }, { onConflict: "key" });
      if (error) throw new Error(error.message);
    }
    await db
      .from("boss_audit_log")
      .insert({
        actor_id: context.userId,
        action: "mt5_settings",
        category: "signals",
        target_key: "mt5",
        metadata: data,
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return { ok: true };
  });
