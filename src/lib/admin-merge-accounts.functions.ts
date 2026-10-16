import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Boss tool: fold a duplicate account into the member's main account (people
 * who signed up again from Telegram's in-app browser). Role checked on the
 * server; the duplicate must not be a boss/admin/dev account. Coins move with
 * the audited admin coin function (debit duplicate, credit main), content is
 * re-owned, and the emptied duplicate is left for the Boss to delete.
 */

const PRIVILEGED = ["boss", "admin", "dev"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireBoss(context: {
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  userId: string;
}) {
  const [{ data: isBoss, error: e1 }, { data: isAdmin, error: e2 }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
  ]);
  if (e1 || e2 || (!isBoss && !isAdmin)) throw new Error("Boss access required.");
}

export type MergeCandidate = {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
  created_at: string;
  telegram_username: string | null;
  telegram_linked: boolean;
  songs: number;
  roles: string[];
  activeSubscription: boolean;
};

async function summarise(db: any, id: string): Promise<MergeCandidate | null> {
  const { data: p } = await db
    .from("profiles")
    .select(
      "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_username",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  const [{ count: songs }, { data: roles }, { data: subs }] = await Promise.all([
    db.from("songs").select("id", { count: "exact", head: true }).eq("user_id", id),
    db.from("user_roles").select("role").eq("user_id", id),
    db.from("subscriptions").select("status").eq("user_id", id),
  ]);
  return {
    id: p.id,
    email: p.email,
    display_name: p.display_name,
    coin_balance: p.coin_balance ?? 0,
    created_at: p.created_at,
    telegram_username: p.telegram_username,
    telegram_linked: p.telegram_chat_id != null,
    songs: songs ?? 0,
    roles: (roles ?? []).map((r: { role: string }) => r.role),
    activeSubscription: (subs ?? []).some((s: { status: string }) =>
      ["active", "trialing", "past_due"].includes(s.status),
    ),
  };
}

/** Find the duplicate by user id, email or username, with a summary of both. */
export const findMergeCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ primaryId: z.string().uuid(), query: z.string().trim().min(2).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireBoss(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const q = data.query.replace(/^@/, "");
    let id: string | null = null;
    if (UUID.test(q)) id = q.toLowerCase();
    else {
      const emails = q.includes("@") ? [q.toLowerCase()] : [`${q.toLowerCase()}@ogstreamz.app`];
      const { data: byEmail } = await db.from("profiles").select("id").in("email", emails).limit(2);
      if (byEmail?.length === 1) id = byEmail[0].id;
      if (!id) {
        const { data: byName } = await db
          .from("profiles")
          .select("id")
          .ilike("display_name", q)
          .limit(2);
        if (byName?.length === 1) id = byName[0].id;
        else if ((byName?.length ?? 0) > 1) {
          return { error: "More than one member has that name. Use their email or user ID." };
        }
      }
    }
    if (!id) return { error: "No account found for that email, username or ID." };
    if (id === data.primaryId) return { error: "That's this same account." };
    const [primary, duplicate] = await Promise.all([
      summarise(db, data.primaryId),
      summarise(db, id),
    ]);
    if (!primary || !duplicate) return { error: "Account not found." };
    return { primary, duplicate };
  });

export const mergeAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ primaryId: z.string().uuid(), duplicateId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireBoss(context as never);
    const { primaryId, duplicateId } = data;
    if (primaryId === duplicateId) throw new Error("Pick two different accounts.");
    if (duplicateId === context.userId) throw new Error("You can't merge away your own account.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: dupRoles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", duplicateId);
    if ((dupRoles ?? []).some((r: { role: string }) => PRIVILEGED.includes(r.role))) {
      throw new Error("A privileged account can't be merged away.");
    }
    const [primary, duplicate] = await Promise.all([
      summarise(db, primaryId),
      summarise(db, duplicateId),
    ]);
    if (!primary || !duplicate) throw new Error("Account not found.");

    const moved: Record<string, number> = {};
    const notes: string[] = [];
    const reown = async (table: string, column = "user_id") => {
      // Count without RETURNING: not every table has an id column.
      const { count, error } = await db
        .from(table)
        .update({ [column]: primaryId }, { count: "exact" })
        .eq(column, duplicateId);
      if (error) notes.push(`${table}: not moved (${error.message})`);
      else if (count) moved[table] = count;
    };

    // Music.
    await reown("songs");
    const { data: primaryUnlocks } = await db
      .from("unlocked_songs")
      .select("song_id")
      .eq("user_id", primaryId);
    const have = (primaryUnlocks ?? []).map((r: { song_id: string }) => r.song_id);
    if (have.length) {
      await db.from("unlocked_songs").delete().eq("user_id", duplicateId).in("song_id", have);
    }
    await reown("unlocked_songs");
    await reown("song_brief_drafts");
    await reown("generation_attempts");

    // Chats and history.
    await reown("og_messages");
    await reown("community_messages");
    await reown("telegram_sign_in_events");
    // Coin history stays with the account it happened on, so each ledger keeps
    // adding up to its balance; the coins themselves move below.
    await reown("payment_refunds");

    // One-per-member access: move only if the main account doesn't have it.
    for (const table of ["sports_guide_access", "vip_pass_purchases"]) {
      const { count } = await db
        .from(table)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", primaryId);
      if (!count) await reown(table);
    }
    {
      const { count } = await db
        .from("vip_pass_credentials")
        .select("assigned_user_id", { count: "exact", head: true })
        .eq("assigned_user_id", primaryId);
      if (!count) await reown("vip_pass_credentials", "assigned_user_id");
    }

    // Referrals they made follow them (never a self-referral).
    {
      const { count, error } = await db
        .from("referrals")
        .update({ referrer_id: primaryId }, { count: "exact" })
        .eq("referrer_id", duplicateId)
        .neq("referee_id", primaryId);
      if (error) notes.push(`referrals: not moved (${error.message})`);
      else if (count) moved.referrals = count;
    }

    // Telegram link moves if the main account has none (one chat per account).
    if (duplicate.telegram_linked && !primary.telegram_linked) {
      const { data: tg } = await db
        .from("profiles")
        .select("telegram_chat_id, telegram_username, telegram_linked_at")
        .eq("id", duplicateId)
        .maybeSingle();
      await db
        .from("profiles")
        .update({ telegram_chat_id: null, telegram_username: null, telegram_link_token: null })
        .eq("id", duplicateId);
      const { error } = await db
        .from("profiles")
        .update({
          telegram_chat_id: tg?.telegram_chat_id ?? null,
          telegram_username: tg?.telegram_username ?? null,
          telegram_linked_at: tg?.telegram_linked_at ?? new Date().toISOString(),
        })
        .eq("id", primaryId);
      if (error) notes.push(`Telegram link not moved (${error.message})`);
      else moved.telegram = 1;
    } else if (duplicate.telegram_linked) {
      notes.push("Both accounts had Telegram linked; the main account's link was kept.");
    }

    // Coins: debit the duplicate, credit the main account, both through the
    // audited admin coin function run as the Boss.
    let coinsMoved = 0;
    const bal = duplicate.coin_balance;
    if (bal > 0) {
      const ref = `merge ${duplicateId} -> ${primaryId}`;
      const { error: debitErr } = await (context.supabase as any).rpc("mint_coins_admin", {
        target_user_id: duplicateId,
        amount: -bal,
        admin_notes: ref,
      });
      if (debitErr) {
        notes.push(`Coins not moved: ${debitErr.message}`);
      } else {
        const { error: creditErr } = await (context.supabase as any).rpc("mint_coins_admin", {
          target_user_id: primaryId,
          amount: bal,
          admin_notes: ref,
        });
        if (creditErr) {
          notes.push(
            `${bal} coins were taken off the duplicate but not added to the main account (${creditErr.message}). Add them by hand.`,
          );
        } else coinsMoved = bal;
      }
    }

    if (duplicate.roles.includes("vip") && !primary.roles.includes("vip")) {
      notes.push(
        "The duplicate had VIP. Turn VIP on for the main account if it should carry over.",
      );
    }
    if (duplicate.activeSubscription) {
      notes.push(
        "The duplicate has an active VIP subscription. It still bills that account; cancel or move it in Stripe.",
      );
    }

    await db.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "merge_accounts",
      category: "users",
      target_key: primaryId,
      metadata: { duplicate: duplicateId, moved, coins: coinsMoved, notes },
    });

    return { ok: true as const, moved, coinsMoved, notes };
  });
