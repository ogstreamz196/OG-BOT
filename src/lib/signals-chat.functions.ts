import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

/** Boss: the signals chat's test account and when it last started fresh. */
export const getSignalsChatState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pa = await import("./paper-account.server");
    const { PURGED_KEY } = await import("./signal-chat.server");
    const { signalsChannelReady } = await import("./signal-broadcast.server");
    const state = await pa.paperState(supabaseAdmin);
    const balance = state ? await pa.paperBalance(supabaseAdmin, state) : null;
    const { data } = await (supabaseAdmin as any)
      .from("site_content")
      .select("value")
      .eq("key", PURGED_KEY)
      .maybeSingle();
    return {
      ready: signalsChannelReady(),
      start: state?.start ?? null,
      startedAt: state?.startedAt ?? null,
      balance,
      purgedAt: (data as { value?: string } | null)?.value ?? null,
    };
  });

/**
 * Boss: purge the signals chat and start every counter fresh at a new test
 * balance (signals-fresh-start.server.ts). No stored data is deleted.
 */
export const purgeSignalsChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { balance: number } => {
    const balance = Number((d as { balance?: unknown } | null)?.balance);
    if (!Number.isFinite(balance) || balance < 10 || balance > 1_000_000)
      throw new Error("Pick a starting balance between $10 and $1,000,000");
    return { balance: Math.round(balance * 100) / 100 };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { freshStart } = await import("./signals-fresh-start.server");
    const out = await freshStart(supabaseAdmin, data.balance);
    await (supabaseAdmin as any)
      .from("boss_audit_log")
      .insert({
        actor_id: context.userId,
        action: "signals_chat_purge",
        category: "signals",
        target_key: "signals.chat.purgedAt",
        metadata: { balance: data.balance, ok: out.ok, swept: out.swept ?? 0 },
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return out as {
      ok: boolean;
      why?: string;
      swept?: number;
      deleteRefused?: string;
      vantageMessage?: boolean;
      testModeMessage?: boolean;
    };
  });

/**
 * Boss: start the demo account without clearing anything (the chat and the
 * win/loss counter stay). OG B0T announces it once; the results post shows
 * the balance live from then on. Refuses if it's already running.
 */
export const startSignalsDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { balance: number } => {
    const balance = Number((d as { balance?: unknown } | null)?.balance);
    if (!Number.isFinite(balance) || balance < 10 || balance > 1_000_000)
      throw new Error("Pick a starting balance between $10 and $1,000,000");
    return { balance: Math.round(balance * 100) / 100 };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { demoStart } = await import("./signals-fresh-start.server");
    const out = await demoStart(supabaseAdmin, data.balance);
    await (supabaseAdmin as any)
      .from("boss_audit_log")
      .insert({
        actor_id: context.userId,
        action: "signals_demo_start",
        category: "signals",
        target_key: "signals.paper",
        metadata: { balance: data.balance, ok: out.ok },
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return out as { ok: boolean; why?: string; announced?: boolean };
  });
