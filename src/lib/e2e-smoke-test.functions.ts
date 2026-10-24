import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SmokeStep = {
  id: string;
  label: string;
  status: "ok" | "fail" | "skip";
  ms: number;
  detail?: string;
};

export type SmokeResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  steps: SmokeStep[];
};

/**
 * One-click end-to-end smoke test:
 *  1. Verifies the caller's Supabase session (sign-in works).
 *  2. Creates a throwaway song row and kicks off suno-generate.
 *  3. Polls for status transition (queued/generating/completed).
 *  4. Sends a test message through chatOgBot to verify OG Bot.
 *  5. Cleans up the throwaway song.
 *
 * Admin-only. Each step is timed and logged independently — a single
 * failure does not abort the whole run.
 */
const SMOKE_SONG_TITLE = "E2E smoke test";
const SMOKE_OG_PING = "ping — automated smoke test";

export const runE2ESmokeTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmokeResult> => {
    const { supabase, userId } = context;
    const steps: SmokeStep[] = [];
    const startedAt = new Date().toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    let songId: string | null = null;

    try {
      // 1) Admin gate + sign-in verified by middleware
      await run("auth", "Verify signed-in session", async () => {
        const { data, error } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        if (error) throw error;
        const isAdmin = (data || []).some((r) => r.role === "admin" || r.role === "dev");
        if (!isAdmin) throw new Error("Caller is not admin/dev");
        return `userId=${userId.slice(0, 8)}… role=admin`;
      });

      // 2) Reuse or create a smoke-test song row (idempotent)
      await run("create_song", "Reuse or create draft song row", async () => {
        const { data: existing } = await supabaseAdmin
          .from("songs")
          .select("id")
          .eq("user_id", userId)
          .eq("title", SMOKE_SONG_TITLE)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          songId = existing.id as string;
          // Reset to draft so we can re-run the pipeline step cleanly.
          await supabaseAdmin
            .from("songs")
            .update({ status: "draft" } as never)
            .eq("id", songId);
          return `reused song_id=${songId}`;
        }
        const { data, error } = await supabase
          .from("songs")
          .insert({
            user_id: userId,
            title: SMOKE_SONG_TITLE,
            prompt: "Smoke test · automated",
            style: "ambient",
            lyrics: "test test test",
            status: "draft",
          } as never)
          .select("id")
          .single();
        if (error || !data?.id) throw new Error(error?.message || "no row");
        songId = data.id;
        return `created song_id=${songId}`;
      });

      // 3) Kick off generation
      if (songId) {
        await run("invoke_generate", "Invoke suno-generate", async () => {
          const { data, error } = await supabase.functions.invoke("suno-generate", {
            body: {
              song_id: songId,
              prompt: "Smoke test · automated",
              lyrics: "test test test",
              title: SMOKE_SONG_TITLE,
              style: "ambient",
            },
          });
          if (error) throw new Error(error.message || "invoke failed");
          if (data?.accepted === false) throw new Error(data.error || "generation capacity full");
          return "queued";
        });

        // 4) Poll status for up to ~20s
        await run("poll_status", "Poll status transition (≤20s)", async () => {
          const deadline = Date.now() + 20_000;
          let last = "draft";
          while (Date.now() < deadline) {
            const { data } = await supabase
              .from("songs")
              .select("status")
              .eq("id", songId!)
              .maybeSingle();
            last = (data as { status?: string } | null)?.status || last;
            if (last !== "draft") return `status=${last}`;
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (last === "draft") throw new Error("Status never left 'draft' within 20s");
          return `status=${last}`;
        });
      }

      // 5) OG Bot round-trip
      await run("og_chat", "Send OG B0T test message", async () => {
        const { chatOgBot } = await import("@/lib/og-messenger.functions");
        const res = await chatOgBot({
          data: {
            messages: [{ role: "user", content: SMOKE_OG_PING }],
            mode: "safe",
          },
        } as never);
        const reply = (res as { reply?: string } | undefined)?.reply || "";
        if (!reply || reply.length < 2) throw new Error("Empty reply from OG B0T");
        return `reply (${reply.length} chars): ${reply.slice(0, 80)}…`;
      });
    } finally {
      // 6) Cleanup — runs even when earlier steps throw. Sweeps every
      // smoke-test artifact for this user, not just this run's row, so
      // leftovers from aborted previous runs are also removed.
      await run("cleanup", "Delete smoke-test artifacts", async () => {
        const notes: string[] = [];

        const { data: songRows, error: songSelErr } = await supabaseAdmin
          .from("songs")
          .select("id")
          .eq("user_id", userId)
          .eq("title", SMOKE_SONG_TITLE);
        if (songSelErr) throw songSelErr;
        const songIds = (songRows || []).map((r) => r.id as string);
        if (songIds.length) {
          const { error: delErr } = await supabaseAdmin.from("songs").delete().in("id", songIds);
          if (delErr) throw delErr;
          notes.push(`songs=${songIds.length}`);
        } else {
          notes.push("songs=0");
        }

        const { data: msgRows, error: msgSelErr } = await supabaseAdmin
          .from("og_messages")
          .select("id")
          .eq("user_id", userId)
          .ilike("content", `%${SMOKE_OG_PING}%`);
        if (msgSelErr) throw msgSelErr;
        const msgIds = (msgRows || []).map((r) => r.id as string);
        if (msgIds.length) {
          const { error: delErr } = await supabaseAdmin
            .from("og_messages")
            .delete()
            .in("id", msgIds);
          if (delErr) throw delErr;
          notes.push(`og_messages=${msgIds.length}`);
        } else {
          notes.push("og_messages=0");
        }

        return notes.join(" · ");
      });
    }

    const finishedAt = new Date().toISOString();
    return {
      ok: steps.every((s) => s.status !== "fail"),
      startedAt,
      finishedAt,
      steps,
    };
  });
