import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Trim quotes/emoji/trailing punctuation the model sometimes wraps titles in. */
export function cleanTitle(raw: string): string {
  return raw
    .split("\n")[0]!
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
}

const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "about",
  "from",
  "they",
  "them",
  "their",
  "have",
  "been",
  "were",
  "when",
  "what",
  "will",
  "would",
  "just",
  "like",
  "really",
  "very",
  "into",
  "your",
  "song",
  "track",
  "make",
  "made",
  "some",
  "always",
  "every",
  "because",
  "there",
  "where",
  "which",
]);

/** First name only — titles never need someone's full name. */
export function firstName(subjectName: string): string {
  return subjectName.trim().split(/\s+/)[0] ?? "";
}

/** Deterministic fallback: a short natural phrase from the story, no full names. */
export function fallbackTitle(subjectName: string, description: string): string {
  const nameParts = new Set(subjectName.toLowerCase().split(/\s+/).filter(Boolean));
  const words = description
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(
      (w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()) && !nameParts.has(w.toLowerCase()),
    )
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
  if (words.length >= 2) return cleanTitle(words.join(" "));
  const name = firstName(subjectName);
  if (words.length === 1 && name) return cleanTitle(`${name}'s ${words[0]}`);
  if (words.length === 1) return cleanTitle(words[0]!);
  if (name) return cleanTitle(`${name} Runs It`);
  return "Late Night Energy";
}

/**
 * Writes a natural, release-style song title from the story and styles.
 * Used when the creator leaves the title field blank. A first name may be
 * used when it fits, but the full name is never required.
 */
export const suggestTrackTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { subjectName?: string; description?: string; style?: string }) => ({
    subjectName: String(data?.subjectName ?? "")
      .trim()
      .slice(0, 60),
    description: String(data?.description ?? "")
      .trim()
      .slice(0, 1200),
    style: String(data?.style ?? "")
      .trim()
      .slice(0, 200),
  }))
  .handler(async ({ data, context }): Promise<{ title: string }> => {
    const backup = fallbackTitle(data.subjectName, data.description);
    try {
      const { aiChatTarget, fetchAiChat } = await import("@/lib/ai-endpoint.server");
      if (!aiChatTarget(context.userId)) return { title: backup };
      const name = firstName(data.subjectName);

      const system = [
        "You name songs like a real artist naming a single. Return ONE title only.",
        "Rules:",
        "- 1 to 4 words, max 28 characters, Title Case. Short and punchy.",
        "- Build it from the strongest image, feeling, phrase or inside joke in the story — something that could be the hook.",
        "- If a first name is given, weave it in naturally when it sounds good (e.g. 'Maya Runs It', 'Leo's Late Shift'). Never use a surname.",
        "- NEVER use 'All About', 'Song for', 'Ode to', 'Tribute to', 'The Name Song' or 'Name — X'.",
        "- Match the genre's vibe (drill: blunt and gritty; pop: catchy; nasheed: reverent).",
        "- No quotes, no emojis, no hashtags, no explanation.",
        "- Do not use the words 'song', 'track', 'anthem' or 'untitled'.",
        "- Output ONLY the title.",
      ].join("\n");

      const { response: res } = await fetchAiChat(
        {
          temperature: 0.95,
          max_tokens: 20,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                name ? `First name (optional to use): ${name}` : "",
                data.style ? `Styles: ${data.style}` : "",
                data.description ? `Story: ${data.description}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        context.userId,
      );
      if (!res.ok) return { title: backup };
      const json = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
      };
      let title = cleanTitle(json.choices?.[0]?.message?.content ?? "");
      // Strip any surname the model sneaked in — first name only.
      const parts = data.subjectName.trim().split(/\s+/).slice(1);
      for (const p of parts) {
        if (p.length > 1)
          title = title.replace(
            new RegExp(`\\s*\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
            "",
          );
      }
      title = cleanTitle(title.replace(/^(song|ode)\s+(for|to)\s+/i, ""));
      return { title: title || backup };
    } catch {
      return { title: backup };
    }
  });
