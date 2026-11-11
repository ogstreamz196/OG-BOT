import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Takes a rough, free-form description written by the user and returns a
 * short, punchy, lyrics-ready paraphrase suitable to feed into the lyrics
 * generator. Does NOT invent facts and does NOT include the subject's name
 * (the name lives in its own field).
 */
export const improveLyricDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { text: string; subjectName?: string }) => {
    const text = String(data?.text ?? "")
      .trim()
      .slice(0, 2000);
    if (!text) throw new Error("Description is empty");
    const subjectName =
      String(data?.subjectName ?? "")
        .trim()
        .slice(0, 60) || null;
    return { text, subjectName };
  })
  .handler(async ({ data, context }): Promise<{ improved: string; draftId: string | null }> => {
    const { aiChatTarget, fetchAiChat } = await import("@/lib/ai-endpoint.server");
    const ai = aiChatTarget(context.userId);
    if (!ai) throw new Error("AI not configured");

    const system = [
      "You rewrite rough songwriter notes into a SHORT, punchy brief for a lyrics AI.",
      "Rules:",
      "- 1–3 sentences, max ~55 words.",
      "- Keep every concrete detail (traits, memories, inside jokes, moods).",
      "- Do NOT invent new facts, names, places or events.",
      "- Do NOT mention or add a person's name — the name is handled separately.",
      "- No headings, no bullet points, no quotes, no emojis, no preamble.",
      "- Output ONLY the rewritten description as plain prose.",
    ].join("\n");

    const { response: res, provider } = await fetchAiChat(
      {
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.text },
        ],
      },
      context.userId,
    );

    if (!res.ok) {
      if (res.status === 429) throw new Error("Rate limit — try again in a moment");
      if (res.status === 402)
        throw new Error(
          `${provider === "gemini" ? "Gemini" : "ChatGPT"} account quota is exhausted`,
        );
      throw new Error(`Improve failed (${res.status})`);
    }
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const improved = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!improved) throw new Error("No improved text returned");

    // Persist as a reusable draft (best-effort; never block the response).
    let draftId: string | null = null;
    try {
      const { data: row, error } = await context.supabase
        .from("song_brief_drafts")
        .insert({
          user_id: context.userId,
          subject_name: data.subjectName,
          original_text: data.text,
          improved_text: improved,
        })
        .select("id")
        .single();
      if (!error && row) draftId = (row as { id: string }).id;
    } catch (_) {
      /* best-effort */
    }

    return { improved, draftId };
  });

const DRAFT_PAGE_SIZE = 8;

/** List the signed-in user's most recent improved briefs for reuse (paginated). */
export const listSongBriefDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data?: { offset?: number }) => ({
    offset: Math.max(0, Math.floor(Number(data?.offset ?? 0)) || 0),
  }))
  .handler(async ({ data, context }) => {
    const from = data.offset;
    const to = from + DRAFT_PAGE_SIZE; // fetch one extra to detect more
    const { data: rows, error } = await context.supabase
      .from("song_brief_drafts")
      .select("id, subject_name, original_text, improved_text, created_at")
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const hasMore = list.length > DRAFT_PAGE_SIZE;
    return {
      drafts: hasMore ? list.slice(0, DRAFT_PAGE_SIZE) : list,
      hasMore,
      nextOffset: from + DRAFT_PAGE_SIZE,
    };
  });

/** Permanently delete one of the user's saved briefs. */
export const deleteSongBriefDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string }) => {
    const id = String(data?.id ?? "").trim();
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("song_brief_drafts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Edit an existing saved brief (improved text and/or subject name). */
export const updateSongBriefDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string; improvedText?: string; subjectName?: string | null }) => {
    const id = String(data?.id ?? "").trim();
    if (!id) throw new Error("id required");
    const improvedText =
      data?.improvedText === undefined
        ? undefined
        : String(data.improvedText).trim().slice(0, 2000);
    if (improvedText !== undefined && !improvedText) throw new Error("Brief can't be empty");
    const subjectName =
      data?.subjectName === undefined
        ? undefined
        : String(data.subjectName ?? "")
            .trim()
            .slice(0, 60) || null;
    return { id, improvedText, subjectName };
  })
  .handler(async ({ data, context }) => {
    const patch: { improved_text?: string; subject_name?: string | null } = {};
    if (data.improvedText !== undefined) patch.improved_text = data.improvedText;
    if (data.subjectName !== undefined) patch.subject_name = data.subjectName;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("song_brief_drafts")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
