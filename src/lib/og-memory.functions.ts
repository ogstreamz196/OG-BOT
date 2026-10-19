import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Memory = { id: string; fact: string; created_at: string };

/** The member's own OG Bot memories and whether memory is on. */
export const listMyMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ enabled: boolean; memories: Memory[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { memoryEnabled } = await import("@/lib/og-memory.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const [enabled, { data }] = await Promise.all([
      memoryEnabled(admin, context.userId),
      admin
        .from("og_memories")
        .select("id, fact, created_at")
        .eq("user_id", context.userId)
        .order("updated_at", { ascending: false }),
    ]);
    return { enabled, memories: (data ?? []) as Memory[] };
  });

/** Forget one memory, or all of them when no id is given. */
export const forgetMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id?: string }) => {
    if (data?.id !== undefined && !/^[0-9a-f-]{36}$/i.test(String(data.id)))
      throw new Error("Invalid memory");
    return { id: data?.id };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    let q = admin.from("og_memories").delete().eq("user_id", context.userId);
    if (data.id) q = q.eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Switch OG Bot's memory on or off. Switching off also clears what it knew. */
export const setMemoryEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { enabled: boolean }) => ({ enabled: !!data?.enabled }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const { error } = await admin
      .from("user_preferences")
      .upsert({ user_id: context.userId, og_memory: data.enabled }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    if (!data.enabled) await admin.from("og_memories").delete().eq("user_id", context.userId);
    return { ok: true };
  });
