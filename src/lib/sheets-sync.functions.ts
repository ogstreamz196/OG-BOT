import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectorReady } from "@/lib/connectors.server";

async function assertBossOrAdmin(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: "admin" | "boss" },
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!a && !b) throw new Error("Forbidden");
}

export const getSheetsConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBossOrAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "users_sheet_id")
      .maybeSingle();
    const id = (data?.value as { id?: string } | null)?.id ?? null;
    return {
      sheetId: id,
      updatedAt: data?.updated_at ?? null,
      connectorPresent: connectorReady("google_sheets"),
    };
  });

export const setSheetsConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { sheetId: string }) => {
    const id = (d?.sheetId ?? "").trim();
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error("Invalid spreadsheet ID");
    return { sheetId: id };
  })
  .handler(async ({ data, context }) => {
    await assertBossOrAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: "users_sheet_id",
      value: { id: data.sheetId },
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const resyncAllProfilesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBossOrAdmin(context);
    const mod = await import("@/lib/sheets-sync.server");
    return mod.resyncAllProfilesToSheet();
  });
