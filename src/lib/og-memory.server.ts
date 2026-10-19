// Storage for OG Bot's memory of a member (see og-memory.ts). Server only.
// Private chat and Telegram read and write it; Battle Zone never sees it.
import {
  MAX_MEMORIES,
  extractorPrompt,
  memoryNote,
  parseMemoryUpdate,
  shouldExtract,
} from "./og-memory";

type AnyClient = { from: (t: string) => any };

/** Is memory switched on for this member? Defaults to on. */
export async function memoryEnabled(admin: AnyClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_preferences")
    .select("og_memory")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { og_memory?: boolean } | null)?.og_memory ?? true;
}

/** The member's saved facts, newest first. Empty when memory is off or on error. */
export async function loadMemories(admin: AnyClient, userId: string): Promise<string[]> {
  try {
    if (!(await memoryEnabled(admin, userId))) return [];
    const { data } = await admin
      .from("og_memories")
      .select("fact")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(MAX_MEMORIES);
    return ((data ?? []) as { fact: string }[]).map((r) => r.fact);
  } catch {
    return [];
  }
}

/** The system-prompt block for these facts. */
export { memoryNote };

/**
 * After a reply, quietly check the member's latest message for facts worth
 * keeping (or ones they've asked OG Bot to forget). Uses the free AI tiers.
 * Never throws; call it without awaiting.
 */
export async function learnFromMessage(
  admin: AnyClient,
  userId: string,
  userText: string,
  existing: string[],
): Promise<void> {
  try {
    if (!shouldExtract(userText)) return;
    if (!(await memoryEnabled(admin, userId))) return;
    const { fetchAiChat } = await import("@/lib/ai-endpoint.server");
    const { response } = await fetchAiChat(
      {
        temperature: 0,
        messages: [{ role: "user", content: extractorPrompt(existing, userText) }],
      },
      "memory",
      { cheap: true },
    );
    if (!response.ok) return;
    const json = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const update = parseMemoryUpdate(json.choices?.[0]?.message?.content ?? "", existing);
    for (const fact of update.forget) {
      await admin
        .from("og_memories")
        .delete()
        .eq("user_id", userId)
        .ilike("fact", fact.replace(/[%_\\]/g, "\\$&"));
    }
    if (update.remember.length) {
      await admin
        .from("og_memories")
        .insert(update.remember.map((fact) => ({ user_id: userId, fact })));
    }
    // Keep the newest MAX_MEMORIES.
    const { data: all } = await admin
      .from("og_memories")
      .select("id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    const extra = ((all ?? []) as { id: string }[]).slice(MAX_MEMORIES).map((r) => r.id);
    if (extra.length) await admin.from("og_memories").delete().in("id", extra);
  } catch (e) {
    console.warn("memory update failed", (e as Error).message);
  }
}
