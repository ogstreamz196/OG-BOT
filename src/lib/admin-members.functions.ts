import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Boss member directory. Everything the Users page needs comes back in one
 * call so the list isn't capped by a single query's row limit and each row
 * doesn't fire its own lookups.
 */

async function assertBoss(supabase: any, userId: string) {
  const [boss, admin] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "boss" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (!boss.data && !admin.data) throw new Error("Forbidden");
}

/** Reads every row of a query in pages of 1000 (the API's per-request cap). */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  max = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type BossMember = {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
  created_at: string;
  roles: string[];
  telegram_linked: boolean;
  telegram_username: string | null;
  og_vip_id: string | null;
  last_sign_in_at: string | null;
  sign_in_count: number;
  vip_trial_ends_at: string | null;
  has_vault: boolean;
  spent_coins: number;
  purchase_count: number;
};

export const listBossMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ members: BossMember[] }> => {
    await assertBoss(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [profiles, roles, vault, purchases] = await Promise.all([
      readAll<any>((a, b) =>
        db
          .from("profiles")
          .select(
            "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_username, og_vip_id, last_sign_in_at, sign_in_count, vip_trial_ends_at",
          )
          .order("created_at", { ascending: false })
          .range(a, b),
      ),
      readAll<{ user_id: string; role: string }>((a, b) =>
        db.from("user_roles").select("user_id, role").range(a, b),
      ),
      readAll<{ user_id: string }>((a, b) =>
        db.from("vip_pass_purchases").select("user_id").range(a, b),
      ),
      readAll<{ user_id: string; amount: number | null }>((a, b) =>
        db
          .from("coin_transactions")
          .select("user_id, amount")
          .eq("type", "stripe_purchase")
          .gt("amount", 0)
          .range(a, b),
      ),
    ]);

    const rolesBy = new Map<string, string[]>();
    for (const r of roles) {
      const list = rolesBy.get(r.user_id) ?? [];
      list.push(r.role);
      rolesBy.set(r.user_id, list);
    }
    const vaultSet = new Set(vault.map((v) => v.user_id));
    const spend = new Map<string, { coins: number; count: number }>();
    for (const p of purchases) {
      const s = spend.get(p.user_id) ?? { coins: 0, count: 0 };
      s.coins += p.amount ?? 0;
      s.count += 1;
      spend.set(p.user_id, s);
    }

    const members: BossMember[] = profiles.map((p) => ({
      id: p.id,
      email: p.email ?? null,
      display_name: p.display_name ?? null,
      coin_balance: p.coin_balance ?? 0,
      created_at: p.created_at,
      roles: rolesBy.get(p.id) ?? [],
      telegram_linked: p.telegram_chat_id != null,
      telegram_username: p.telegram_username ?? null,
      og_vip_id: p.og_vip_id ?? null,
      last_sign_in_at: p.last_sign_in_at ?? null,
      sign_in_count: p.sign_in_count ?? 0,
      vip_trial_ends_at: p.vip_trial_ends_at ?? null,
      has_vault: vaultSet.has(p.id),
      spent_coins: spend.get(p.id)?.coins ?? 0,
      purchase_count: spend.get(p.id)?.count ?? 0,
    }));
    return { members };
  });

export type MemberActivity = {
  signIns: {
    id: string;
    created_at: string;
    device_type: string | null;
    os: string | null;
    browser: string | null;
    is_signup: boolean;
  }[];
  songs: { id: string; title: string | null; status: string | null; created_at: string }[];
  songCount: number;
  coins: { id: string; type: string | null; amount: number; created_at: string }[];
};

/** Recent sign-ins (device type only, never location), tracks and coin moves. */
export const getMemberActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<MemberActivity> => {
    await assertBoss(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [signIns, songs, songCount, coins] = await Promise.all([
      db
        .from("sign_in_events")
        .select("id, created_at, device_type, os, browser, is_signup")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(10),
      db
        .from("songs")
        .select("id, title, status, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(10),
      db.from("songs").select("id", { count: "exact", head: true }).eq("user_id", data.userId),
      db
        .from("coin_transactions")
        .select("id, type, amount, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    return {
      signIns: (signIns.data ?? []).map((r: any) => ({
        id: String(r.id),
        created_at: r.created_at,
        device_type: r.device_type ?? null,
        os: r.os ?? null,
        browser: r.browser ?? null,
        is_signup: !!r.is_signup,
      })),
      songs: (songs.data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title ?? null,
        status: r.status ?? null,
        created_at: r.created_at,
      })),
      songCount: songCount.count ?? 0,
      coins: (coins.data ?? []).map((r: any) => ({
        id: String(r.id),
        type: r.type ?? null,
        amount: r.amount ?? 0,
        created_at: r.created_at,
      })),
    };
  });
