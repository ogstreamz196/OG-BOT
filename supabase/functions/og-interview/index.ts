// OG Bot "Get to know me" interview — asks personal questions to enrich
// lyric generation. Uses the same Gemini key as generate-lyrics. Free to
// call (no coin deduction) — short responses, rate-limited by Gemini.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/clients.ts";
import { geminiUsage, logAiUsage } from "../_shared/ai-usage.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

type Turn = { role: "bot" | "user"; text: string };

const SYSTEM_NEXT = `
You are OG Bot — a sharp, warm British AI companion. Your job is to interview
the user so the songwriter can write a deeply personal song for them or about
someone they care about.

RULES:
- Ask ONE question at a time. Keep it short (max 18 words).
- Each question must dig for SPECIFIC, sensory, personal detail:
  names, nicknames, places, dates, inside jokes, quirks, drama, vivid
  memories, favourite foods/songs, signature phrases, smells, weather.
- Mix categories aggressively: identity, relationships, milestones, regrets,
  flexes, silly habits, pet peeves, dreams. Do NOT repeat themes already
  covered in the transcript.
- Build on what they JUST said when natural ("you said X — tell me more
  about Y"), but every few turns jump to a brand new angle.
- Never ask yes/no questions. Never ask "what would you like the song to
  say". Never give advice or commentary — just ask the next question.
- If the transcript is empty, kick off with a punchy opener like
  "Right — who's this song for, and what's the one word that sums them up?"
- Voice: British, warm, witty, plain-spoken. No emojis. No preamble.

Output ONLY the next question text. No quotes. No labels.
`.trim();

const SYSTEM_SUMMARY = `
You are a sharp editor. The user has been interviewed by OG Bot to gather
material for a personalised song. Distil their answers into a compact,
high-signal brief the songwriter can weave into lyrics.

RULES:
- Output 6–14 short bullet-style lines, each starting with a label and a
  colon, e.g. "Their name: Aaliyah", "Inside joke: still can't parallel
  park", "Defining memory: cried laughing at the karaoke night in Soho".
- Keep every concrete detail the user gave: names, places, dates, quirks,
  phrases, foods, music, drama. Drop filler and your own commentary.
- If the user gave conflicting answers, keep the latest.
- Maximum 480 characters total. Plain text only — no markdown, no quotes,
  no preamble, no closing line.
`.trim();

function buildTranscript(history: Turn[]): string {
  return history
    .slice(-30)
    .map((t) => `${t.role === "bot" ? "OG Bot" : "User"}: ${t.text.trim()}`)
    .join("\n");
}

async function callGemini(
  system: string,
  user: string,
  maxTokens: number,
  feature: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.95, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  logAiUsage({ feature, provider: "gemini", model: GEMINI_MODEL, ...geminiUsage(data) });
  return ((data?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>)
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const action = (body.action ?? "next").toString();
    const seed = (body.seed ?? "").toString().slice(0, 400);
    const historyRaw = Array.isArray(body.history) ? body.history : [];
    const history: Turn[] = historyRaw
      .filter(
        (t: unknown): t is { role: string; text: string } =>
          !!t &&
          typeof (t as { role?: unknown }).role === "string" &&
          typeof (t as { text?: unknown }).text === "string",
      )
      .map((t: { role: string; text: string }) => ({
        role: t.role === "user" ? "user" : "bot",
        text: t.text.slice(0, 600),
      }));

    const transcript = buildTranscript(history);

    if (action === "summarize") {
      const userMsg =
        `Existing details the user already typed (keep these as ground truth):\n${seed || "(none)"}\n\n` +
        `Interview transcript:\n${transcript || "(no answers yet)"}\n\n` +
        `Write the brief now.`;
      const summary = await callGemini(SYSTEM_SUMMARY, userMsg, 600, "interview_summary");
      return jsonResponse({ summary: summary.slice(0, 500) });
    }

    // action === "next"
    const userMsg =
      (seed ? `Context the user already typed:\n${seed}\n\n` : "") +
      `Conversation so far:\n${transcript || "(empty — this is the opening question)"}\n\n` +
      `Now write ONLY the next question. One sentence. No preamble.`;
    const question = await callGemini(SYSTEM_NEXT, userMsg, 120, "interview_question");
    // Strip surrounding quotes / labels just in case.
    const cleaned = question
      .replace(/^["'`\s]+|["'`\s]+$/g, "")
      .replace(/^OG Bot:\s*/i, "")
      .replace(/^Question:\s*/i, "")
      .slice(0, 240);
    return jsonResponse({ question: cleaned });
  } catch (e) {
    console.error("og-interview error", e);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
