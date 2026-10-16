import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coin ledger tools for the Boss. The ledger (coin_transactions) is the record
 * of every coin move; a member's balance should always equal the sum of their
 * ledger rows. These functions find members where it doesn't, fix them in the
 * open (every fix is itself a ledger row or a logged Boss action), and run the
 * one-off balance reset.
 */

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

/** Reads every row of a query in pages of 1000 (the API's per-request cap). */
async function readAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 2_000_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Ledger sum and row count per member, for the given members or everyone. */
async function ledgerSums(db: any, ids?: string[]) {
  const sums = new Map<string, { sum: number; count: number }>();
  const add = (rows: { user_id: string; amount: number }[]) => {
    for (const t of rows) {
      const cur = sums.get(t.user_id) ?? { sum: 0, count: 0 };
      cur.sum += Number(t.amount) || 0;
      cur.count += 1;
      sums.set(t.user_id, cur);
    }
  };
  if (!ids) {
    add(
      await readAll((a, b) =>
        db.from("coin_transactions").select("user_id,amount").order("id").range(a, b),
      ),
    );
    return sums;
  }
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    add(
      await readAll((a, b) =>
        db
          .from("coin_transactions")
          .select("user_id,amount")
          .in("user_id", batch)
          .order("id")
          .range(a, b),
      ),
    );
  }
  return sums;
}

export type CoinDiscrepancy = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
  ledgerSum: number;
  delta: number;
  txCount: number;
};

export type CoinAuditResult =
  | { ok: true; checked: number; discrepancies: CoinDiscrepancy[]; scope: "all" | "user" }
  | { error: string };

export const auditCoinBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId?: string }) =>
    z.object({ userId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<CoinAuditResult> => {
    try {
      await assertBoss(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as any;

      const profiles: {
        id: string;
        email: string | null;
        display_name: string | null;
        coin_balance: number;
      }[] = data.userId
        ? ((
            await db
              .from("profiles")
              .select("id,email,display_name,coin_balance")
              .eq("id", data.userId)
          ).data ?? [])
        : await readAll((a, b) =>
            db
              .from("profiles")
              .select("id,email,display_name,coin_balance")
              .order("id")
              .range(a, b),
          );
      if (profiles.length === 0) {
        return { ok: true, checked: 0, discrepancies: [], scope: data.userId ? "user" : "all" };
      }

      const sums = await ledgerSums(db, data.userId ? [data.userId] : undefined);
      const discrepancies: CoinDiscrepancy[] = [];
      for (const p of profiles) {
        const agg = sums.get(p.id) ?? { sum: 0, count: 0 };
        const balance = Number(p.coin_balance) || 0;
        const delta = balance - agg.sum;
        if (delta !== 0) {
          discrepancies.push({
            user_id: p.id,
            email: p.email ?? null,
            display_name: p.display_name ?? null,
            balance,
            ledgerSum: agg.sum,
            delta,
            txCount: agg.count,
          });
        }
      }
      discrepancies.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return {
        ok: true,
        checked: profiles.length,
        discrepancies,
        scope: data.userId ? "user" : "all",
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Audit failed" };
    }
  });

export type ReconcileResult =
  | { ok: true; user_id: string; previous: number; corrected: number; delta: number }
  | { error: string };

/**
 * Brings one member's balance and ledger back in line.
 * - "ledger": the history is right, so the balance is moved to the ledger sum
 *   (never below 0; if the ledger is negative a correction row brings it to 0).
 * - "balance": the balance is right, so a labelled correction row is added to
 *   the ledger. The member's coins don't change.
 */
export const reconcileUserCoinBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; trust?: "ledger" | "balance" }) =>
    z
      .object({ userId: z.string().uuid(), trust: z.enum(["ledger", "balance"]).default("ledger") })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ReconcileResult> => {
    try {
      await assertBoss(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as any;

      const { data: profile, error: pErr } = await db
        .from("profiles")
        .select("coin_balance")
        .eq("id", data.userId)
        .maybeSingle();
      if (pErr) return { error: pErr.message };
      if (!profile) return { error: "User not found" };

      const ledger = (await ledgerSums(db, [data.userId])).get(data.userId)?.sum ?? 0;
      const prev = Number(profile.coin_balance) || 0;
      if (ledger === prev) {
        return { ok: true, user_id: data.userId, previous: prev, corrected: prev, delta: 0 };
      }
      const ref = `reconcile:${data.trust}:${new Date().toISOString()}`;

      let corrected = prev;
      if (data.trust === "balance") {
        const { error } = await db.from("coin_transactions").insert({
          user_id: data.userId,
          amount: prev - ledger,
          type: "ledger_correction",
          reference: ref,
        });
        if (error) return { error: error.message };
      } else {
        const target = Math.max(0, ledger);
        if (target !== prev) {
          // Balance only, no ledger row: the ledger already holds this history.
          const { error } = await db.rpc("increment_coin_balance", {
            _user_id: data.userId,
            _delta: target - prev,
          });
          if (error) return { error: error.message };
        }
        if (target !== ledger) {
          await db.from("coin_transactions").insert({
            user_id: data.userId,
            amount: target - ledger,
            type: "ledger_correction",
            reference: `${ref}:floor_at_zero`,
          });
        }
        corrected = target;
      }

      await db.from("boss_audit_log").insert({
        actor_id: context.userId,
        action: "coin_reconcile",
        category: "coins",
        target_key: data.userId,
        metadata: {
          trust: data.trust,
          balance_before: prev,
          ledger_before: ledger,
          balance_after: corrected,
        },
      });
      return { ok: true, user_id: data.userId, previous: prev, corrected, delta: corrected - prev };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Reconcile failed" };
    }
  });

export const RESET_BATCH = 40;

export type ResetBatchResult =
  | {
      ok: true;
      processed: number;
      changed: number;
      skippedBoss: number;
      corrected: number;
      nextAfterId: string | null;
    }
  | { error: string };

/**
 * One batch of the one-off balance reset: every member except Boss accounts
 * is set to `target` coins. Any old drift is first written into the ledger as
 * a correction, then the balance is set through set_balance_admin, which
 * changes the balance and writes the ledger row in one step. Afterwards each
 * member's ledger sums to exactly their balance. The page calls this
 * repeatedly with the returned cursor until nextAfterId is null.
 */
export const resetMemberBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        runId: z.string().regex(/^[a-z0-9-]{6,40}$/),
        target: z.number().int().min(0).max(1000),
        afterId: z.string().uuid().nullable(),
        confirm: z.literal("RESET"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ResetBatchResult> => {
    try {
      await assertBoss(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as any;
      const reference = `balance_reset:${data.runId}`;

      let q = db.from("profiles").select("id,coin_balance").order("id").limit(RESET_BATCH);
      if (data.afterId) q = q.gt("id", data.afterId);
      const { data: rows, error } = await q;
      if (error) return { error: error.message };
      const batch = (rows ?? []) as { id: string; coin_balance: number }[];
      if (!batch.length) {
        return {
          ok: true,
          processed: 0,
          changed: 0,
          skippedBoss: 0,
          corrected: 0,
          nextAfterId: null,
        };
      }
      const ids = batch.map((r) => r.id);

      if (!data.afterId) {
        await db.from("boss_audit_log").insert({
          actor_id: context.userId,
          action: "coin_balance_reset",
          category: "coins",
          target_key: data.runId,
          metadata: { target: data.target, excludes: "admin, boss" },
        });
      }

      const [{ data: roleRows }, { data: doneRows }, sums] = await Promise.all([
        db
          .from("user_roles")
          .select("user_id,role")
          .in("user_id", ids)
          .in("role", ["admin", "boss"]),
        db
          .from("coin_transactions")
          .select("user_id")
          .in("user_id", ids)
          .eq("reference", reference),
        ledgerSums(db, ids),
      ]);
      const boss = new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id));
      const done = new Set((doneRows ?? []).map((r: { user_id: string }) => r.user_id));

      let changed = 0;
      let corrected = 0;
      for (const p of batch) {
        if (boss.has(p.id) || done.has(p.id)) continue;
        const balance = Number(p.coin_balance) || 0;
        const ledger = sums.get(p.id)?.sum ?? 0;
        if (ledger !== balance) {
          await db.from("coin_transactions").insert({
            user_id: p.id,
            amount: balance - ledger,
            type: "ledger_correction",
            reference: `${reference}:opening`,
          });
          corrected++;
        }
        if (balance === data.target) continue;
        const { error: setErr } = await (context.supabase as any).rpc("set_balance_admin", {
          target_user_id: p.id,
          new_balance: data.target,
          admin_notes: reference,
        });
        if (setErr) {
          return {
            error: /unauthor/i.test(setErr.message)
              ? "Your account needs full Boss access for this. In Members, turn your Boss switch off and on (ask another Boss), then try again."
              : setErr.message,
          };
        }
        changed++;
      }

      return {
        ok: true,
        processed: batch.length,
        changed,
        skippedBoss: batch.filter((p) => boss.has(p.id)).length,
        corrected,
        nextAfterId: batch.length < RESET_BATCH ? null : batch[batch.length - 1].id,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Reset failed" };
    }
  });
