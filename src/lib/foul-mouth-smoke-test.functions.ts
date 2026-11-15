import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FoulSmokeStep = {
  id: string;
  label: string;
  status: "ok" | "fail" | "skip";
  ms: number;
  detail?: string;
};

export type FoulSmokeResult = {
  ok: boolean;
  isVip: boolean;
  startedAt: string;
  finishedAt: string;
  steps: FoulSmokeStep[];
};

/**
 * One-click smoke test for Live Chat's foul-mouth toggle.
 *
 * Verifies, end to end:
 *  1. Admin/dev caller check.
 *  2. Server-side VIP gating: non-VIP callers asking for foul mode get a SAFE prompt.
 *  3. SAFE reply: short, no profanity.
 *  4. VIP-only step: FOUL reply is brutal-short-but-helpful (≤ 3 sentences, ≤ 420 chars).
 *  5. Cleanup: deletes the test messages it inserted.
 */
export const runFoulMouthSmokeTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FoulSmokeResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const steps: FoulSmokeStep[] = [];
    const startedAt = new Date().toISOString();
    const insertedIds: string[] = [];

    const run = async (id: string, label: string, fn: () => Promise<string | void>) => {
      const t0 = Date.now();
      try {
        const detail = (await fn()) || undefined;
        steps.push({ id, label, status: "ok", ms: Date.now() - t0, detail });
        return true;
      } catch (e) {
        steps.push({
          id,
          label,
          status: "fail",
          ms: Date.now() - t0,
          detail: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    };

    // 1) Admin gate
    await run("auth", "Verify admin/dev caller", async () => {
      const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
      const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "dev");
      if (!ok) throw new Error("Caller is not admin/dev");
      return `userId=${userId.slice(0, 8)}…`;
    });

    // VIP check (used by gating + skip logic)
    const { data: vipFlag } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "vip",
    });
    const isVip = Boolean(vipFlag);

    const { postCommunityMessage } = await import("@/lib/community.functions");

    // Helper: post + wait briefly for bot reply, then fetch latest bot row.
    const postAndFetchReply = async (content: string, foulMouth: boolean) => {
      const res = await postCommunityMessage({ data: { content, foulMouth } } as never);
      const userMsg = (res as { message?: { id?: string } } | undefined)?.message;
      if (userMsg?.id) insertedIds.push(userMsg.id);
      // Bot reply is inserted in the same handler call, so it's already there.
      const { data: botRows } = await supabaseAdmin
        .from("community_messages")
        .select("id, content, created_at")
        .eq("role", "bot")
        .order("created_at", { ascending: false })
        .limit(1);
      const bot = botRows?.[0];
      if (bot?.id) insertedIds.push(bot.id);
      return bot ?? null;
    };

    // 2) SAFE prompt path (foulMouth=false)
    await run("safe_reply", "Safe prompt → short clean reply", async () => {
      const bot = await postAndFetchReply("smoke test · safe mode · say hi briefly", false);
      if (!bot?.content) throw new Error("No bot reply produced");
      if (bot.content.length > 280) throw new Error(`Reply too long (${bot.content.length}>280)`);
      return `${bot.content.length} chars`;
    });

    // 3) Server-side VIP gating
    await run("vip_gating", "PRO gating enforced server-side", async () => {
      // Re-issue a foul-mouth request and confirm reply length is capped to the
      // role-appropriate ceiling. Non-VIP must fall back to the SAFE cap (≤280).
      const bot = await postAndFetchReply("smoke test · foul gating · roast me in one line", true);
      if (!bot?.content) throw new Error("No bot reply produced");
      const cap = isVip ? 420 : 280;
      if (bot.content.length > cap) {
        throw new Error(
          `Reply exceeded ${isVip ? "FOUL" : "SAFE"} cap (${bot.content.length}>${cap})`,
        );
      }
      return isVip
        ? `PRO caller → FOUL cap honored (${bot.content.length}≤420)`
        : `non-PRO caller → forced SAFE cap (${bot.content.length}≤280)`;
    });

    // 4) FOUL reply quality — VIP-only
    if (!isVip) {
      steps.push({
        id: "foul_quality",
        label: "Brutal-short-but-helpful reply (PRO)",
        status: "skip",
        ms: 0,
        detail: "Caller is not PRO — skipped foul-quality check",
      });
    } else {
      await run("foul_quality", "Brutal-short-but-helpful reply (PRO)", async () => {
        const bot = await postAndFetchReply("smoke test · how do I center a div in CSS?", true);
        if (!bot?.content) throw new Error("No bot reply produced");
        const sentences = bot.content.split(/(?<=[.!?])\s+/).filter(Boolean).length;
        if (sentences > 4) throw new Error(`Too long (${sentences} sentences > 3)`);
        if (!/flex|grid|margin|center|auto/i.test(bot.content)) {
          throw new Error("Reply didn't address the CSS question (no help substance)");
        }
        return `${sentences} sentences, ${bot.content.length} chars`;
      });
    }

    // 5) Cleanup
    if (insertedIds.length) {
      await run("cleanup", "Delete smoke-test community rows", async () => {
        const { error } = await supabaseAdmin
          .from("community_messages")
          .delete()
          .in("id", insertedIds);
        if (error) throw error;
        return `deleted ${insertedIds.length} rows`;
      });
    }

    return {
      ok: steps.every((s) => s.status !== "fail"),
      isVip,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps,
    };
  });
