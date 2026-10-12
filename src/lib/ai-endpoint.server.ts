/**
 * Central AI routing for the app.
 *
 * Free keyed tiers answer ordinary text first; the Boss's Gemini account is
 * the paid tier. A provider can take over once after a retryable 429/5xx response.
 * Lovable AI is never used as a fallback.
 */

export type AiChatTarget = {
  url: string;
  headers: Record<string, string>;
  model: string;
  provider: "gemini" | "openai" | "groq" | "groq-backup" | "openrouter" | "pollinations";
  /** Free fallback tiers get text-only messages and no provider-specific params. */
  free?: boolean;
};

const GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function geminiTarget(): AiChatTarget | null {
  const gemini = process.env.GEMINI_API_KEY;
  if (!gemini) return null;
  return {
    url: GEMINI_OPENAI_URL,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gemini}` },
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    provider: "gemini",
  };
}

function keyed(
  envKey: string,
  provider: AiChatTarget["provider"],
  url: string,
  model: string,
  extra: Record<string, string> = {},
): AiChatTarget | null {
  const key = process.env[envKey];
  if (!key) return null;
  return {
    url,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extra },
    model,
    provider,
    free: true,
  };
}

const OR_HEADERS = { "HTTP-Referer": "https://ogbot.co.uk", "X-Title": "OG BOT" };
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const POLL_URL = "https://gen.pollinations.ai/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Passed the live Foul Mouth test (swears back reliably and fast). */
export const FOUL_CAPABLE_FREE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/**
 * Free tiers — answer ordinary chat first. Keyed tiers are skipped when their
 * secret is missing. Gemini (paid) is reserved for pro questions, media, or
 * when every free tier fails.
 *
 * Foul Mouth ON: Groq and Pollinations stay too polite in live tests, so only
 * the OpenRouter model that actually swears is used, then Gemini.
 */
export function freeFallbackTargets(foulMouth = false): AiChatTarget[] {
  const openrouter = ["OPENROUTER_API_KEY", "OPENROUTER_BACKUP_API_KEY"].map((env) =>
    keyed(env, "openrouter", OR_URL, FOUL_CAPABLE_FREE_MODEL, OR_HEADERS),
  );
  const list = foulMouth
    ? openrouter
    : [
        keyed("GROQ_API_KEY", "groq", GROQ_URL, "qwen/qwen3.8-27b"),
        keyed("GROQ_API_KEY", "groq", GROQ_URL, "openai/gpt-oss-120b"),
        // Second Groq account — separate rate-limit budget.
        keyed("GROQ_BACKUP_API_KEY", "groq-backup", GROQ_URL, "qwen/qwen3.8-27b"),
        keyed("GROQ_BACKUP_API_KEY", "groq-backup", GROQ_URL, "openai/gpt-oss-120b"),
        keyed("POLLINATIONS_API_KEY", "pollinations", POLL_URL, "openai-fast"),
        keyed("POLLINATIONS_BACKUP_API_KEY", "pollinations", POLL_URL, "openai-fast"),
        ...openrouter,
      ];
  return list.filter((t): t is AiChatTarget => t !== null);
}

type ProMsg = { role: string; content: unknown };
/** Heuristic: does this conversation need a "pro" (paid Gemini) answer? */
export function needsProAnswer(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? (body.messages as ProMsg[]) : [];
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = typeof last?.content === "string" ? last.content : "";
  if (text.length > 1200) return true;
  return /\b(analy[sz]e|in detail|step[- ]by[- ]step|explain (?:how|why)|write (?:me )?(?:code|a script|an essay|a report|a contract)|debug|legal|contract|medical|diagnos|tax|business plan|compare .* (?:vs|versus|and)|pros and cons|calculate|maths?|equation|translate this)\b/i.test(
    text,
  );
}


// OpenAI removed from the system by owner request — Gemini is the only paid tier.
export function aiChatTargets(_affinity = "default"): AiChatTarget[] {
  const gemini = geminiTarget();
  return gemini ? [gemini] : [];
}

/** Backwards-compatible primary target for diagnostics and simple probes. */
export function aiChatTarget(affinity = "default"): AiChatTarget | null {
  return aiChatTargets(affinity)[0] ?? null;
}

type Msg = { role: string; content: unknown };

/** Flatten multimodal content to plain text so any free model accepts it. */
function freeBody(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? (body.messages as Msg[]) : [];
  const flat = messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    if (Array.isArray(m.content)) {
      const text = (m.content as { type?: string; text?: string }[])
        .map((p) =>
          p.type === "text" ? (p.text ?? "") : p.type === "image_url" ? "[image attached]" : "",
        )
        .filter(Boolean)
        .join("\n");
      return { role: m.role, content: text };
    }
    return { role: m.role, content: String(m.content ?? "") };
  });
  const out: Record<string, unknown> = { messages: flat };
  if (body.stream) out.stream = true;
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  return out;
}

function shouldFallThrough(status: number): boolean {
  return status === 429 || status === 402 || status === 401 || status === 403 || status >= 500;
}


function hasMedia(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? (body.messages as Msg[]) : [];
  return messages.some(
    (m) =>
      Array.isArray(m.content) && (m.content as { type?: string }[]).some((p) => p.type !== "text"),
  );
}

/** Fire-and-forget usage log for the Boss cost panel. Never throws. */
export function logAiUsage(entry: {
  feature: string;
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): void {
  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("ai_usage_log").insert({
        feature: entry.feature,
        provider: entry.provider,
        model: entry.model ?? null,
        prompt_tokens: entry.promptTokens ?? 0,
        completion_tokens: entry.completionTokens ?? 0,
        total_tokens: entry.totalTokens ?? 0,
      });
    } catch (e) {
      console.warn("ai_usage_log insert failed", e);
    }
  })();
}

export async function fetchAiChat(
  body: Record<string, unknown>,
  affinity = "default",
  opts: { foulMouth?: boolean } = {},
): Promise<{ response: Response; provider: AiChatTarget["provider"] }> {
  // Free AIs answer ordinary chat; paid Gemini goes first only for media or
  // pro-level questions, and is otherwise the fallback when free tiers fail.
  // Foul Mouth ON only uses free models that passed the live swearing test.
  const free = freeFallbackTargets(!!opts.foulMouth);
  const pro = hasMedia(body) || needsProAnswer(body);
  const targets = pro
    ? [...aiChatTargets(affinity), ...free]
    : [...free, ...aiChatTargets(affinity)];
  let last: { response: Response; provider: AiChatTarget["provider"] } | null = null;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    let response: Response;
    try {
      response = await fetch(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify({ ...(target.free ? freeBody(body) : body), model: target.model }),
        signal: AbortSignal.timeout(target.free ? 15_000 : 45_000),
      });
    } catch (e) {
      console.warn(`AI ${target.provider}/${target.model} network error`, e);
      continue;
    }
    let fallThrough = target.free ? !response.ok : shouldFallThrough(response.status);
    // Free tiers sometimes return 200 with an empty/refused body — treat as a failure
    // so the next free provider gets a go instead of the user seeing "…".
    if (!fallThrough && target.free && !body.stream && index < targets.length - 1) {
      try {
        const text = await response.clone().text();
        const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
        if (!(j.choices?.[0]?.message?.content ?? "").trim()) fallThrough = true;
      } catch {
        fallThrough = true;
      }
    }
    if (!fallThrough || index === targets.length - 1) {
      // Chat responses are streamed back to the caller, so token counts aren't
      // available here — log the call itself (provider + model) instead.
      logAiUsage({ feature: "chat", provider: target.provider, model: target.model });
      return { response, provider: target.provider };
    }
    console.warn(`AI ${target.provider}/${target.model} returned ${response.status}, falling back`);
    // Don't hammer the same provider: skip its other models after a 429.
    if (response.status === 429) {
      for (let j = index + 1; j < targets.length; j += 1) {
        if (targets[j].provider === target.provider && targets[j].free) targets.splice(j--, 1);
      }
    }
    last = { response, provider: target.provider };
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 200)));
  }

  if (last) return last;
  throw new Error("All AI providers are busy — try again in a moment.");
}

export function needsLiveResearch(text: string): boolean {
  return /(?:^\s*(?:\/research|research:)|\b(?:search the web|look (?:it|this|that) up|latest|today'?s|current news|breaking news|live score|current price|right now)\b)/i.test(
    text,
  );
}

export async function getLiveResearchContext(query: string): Promise<string | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const cleaned = query
    .replace(/^\s*(?:\/research|research:)\s*/i, "")
    .trim()
    .slice(0, 500);
  if (!cleaned) return null;
  const response = await fetch("https://api.perplexity.ai/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: cleaned, max_results: 5 }),
  });
  if (!response.ok) {
    console.warn("Perplexity search failed", response.status);
    return null;
  }
  const json = (await response.json().catch(() => ({}))) as {
    results?: { title?: string; url?: string; snippet?: string; date?: string }[];
  };
  const results = json.results ?? [];
  if (!results.length) return null;
  return results
    .map(
      (item, index) =>
        `${index + 1}. ${item.title ?? "Source"}${item.date ? ` (${item.date})` : ""}\n${item.snippet ?? ""}\n${item.url ?? ""}`,
    )
    .join("\n\n");
}

/** Transcribe audio bytes with the Boss's own Gemini key. */
export async function transcribeWithGemini(audioBase64: string, mime: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Speech-to-text not configured (GEMINI_API_KEY missing)");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Transcribe this audio clip verbatim. Reply with ONLY the spoken words, no commentary.",
              },
              { inline_data: { mime_type: mime, data: audioBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Gemini STT error", res.status, body.slice(0, 300));
    if (res.status === 429) throw new Error("Rate-limited — try again in a moment.");
    throw new Error(`Transcription failed (HTTP ${res.status})`);
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  logAiUsage({
    feature: "transcription",
    provider: "gemini",
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  });
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
}
