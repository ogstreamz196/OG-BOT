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

export type MessageTier = "banter" | "complex" | "unsure";

/** Fast first read of the latest message: obvious banter, clearly hard, or unsure. */
export function messageTier(text: string): MessageTier {
  const t = text.trim();
  if (needsProAnswer({ messages: [{ role: "user", content: t }] })) return "complex";
  if (t.length > 400 || /```|\n.*\n.*\n/.test(t) || (t.match(/\?/g) ?? []).length >= 3)
    return "complex";
  const asks =
    /\?|^(how|why|what|which|should|could|would|can|is|are|do|does|explain|help|tell me)\b/i.test(
      t,
    );
  if (asks && t.length >= 25) return "unsure";
  return "banter";
}

const ROUTER_TIMEOUT_MS = 1_500;

/**
 * For messages that might need real thinking, ask a tiny free model to judge.
 * Any failure counts as banter, so routing is never worse than before.
 */
export async function needsThinking(text: string): Promise<boolean> {
  const key = process.env.GROQ_API_KEY || process.env.GROQ_BACKUP_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.GROQ_ROUTER_MODEL || "llama-3.1-8b-instant",
        temperature: 0,
        max_tokens: 3,
        messages: [
          {
            role: "user",
            content: `Route this chat message. Reply with one word only.
BANTER = chit-chat, jokes, roasts, greetings, opinions, or a simple one-line fact.
THINK = needs reasoning or care: explanations, advice, maths, planning, comparisons, writing something long, money, health, legal or technical help.

Message: """${text.slice(0, 1200)}"""`,
          },
        ],
      }),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const j = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    return /THINK/i.test(j.choices?.[0]?.message?.content ?? "");
  } catch {
    return false;
  }
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

/** The latest user message as plain text (the wrapped live-facts form keeps the question at the end). */
function lastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as Msg[]) : [];
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  const text =
    typeof last.content === "string"
      ? last.content
      : Array.isArray(last.content)
        ? (last.content as { type?: string; text?: string }[])
            .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
            .join(" ")
        : "";
  const q = text.match(/USER QUESTION:\n([\s\S]*?)\n\n/);
  return (q?.[1] ?? text).trim();
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

const FREE_TIMEOUT_MS = 15_000;
export const FOUL_FREE_TIMEOUT_MS = 10_000;
/**
 * Foul Mouth: if the swearing model hasn't answered by now, Gemini starts as
 * a backup and whichever lands first is used. The voice is the same prompt
 * either way; this only cuts the long waits.
 */
export const aiTiming = { foulHedgeMs: 5_000 };

export type AiChatOpts = {
  foulMouth?: boolean;
  /** OG Bot chat: judge how hard the latest message is before picking a model. */
  smart?: boolean;
  /** Background jobs (memory notes): free tiers first, whatever the length. */
  cheap?: boolean;
};

/** Which models to try, in order, and whether the paid tier goes first. */
async function chatPlan(
  body: Record<string, unknown>,
  affinity: string,
  opts: AiChatOpts,
): Promise<{ free: AiChatTarget[]; paid: AiChatTarget[]; pro: boolean }> {
  // Free AIs answer ordinary chat; paid Gemini goes first only for media or
  // pro-level questions, and is otherwise the fallback when free tiers fail.
  // Foul Mouth ON only uses free models that passed the live swearing test.
  const free = freeFallbackTargets(!!opts.foulMouth);
  let pro = !opts.cheap && (hasMedia(body) || needsProAnswer(body));
  // Foul Mouth keeps its tested routing (the swearing model first) so OG Bot's
  // voice never softens; smart routing only re-routes clean chat.
  if (!pro && opts.smart && !opts.foulMouth) {
    const text = lastUserText(body);
    const tier = messageTier(text);
    pro = tier === "complex" || (tier === "unsure" && (await needsThinking(text)));
  }
  return { free, paid: aiChatTargets(affinity), pro };
}

type Attempt = { response: Response; provider: AiChatTarget["provider"]; ok: boolean };

/** Tries each target in turn; the last one is returned even when it fails. */
async function tryTargets(
  list: AiChatTarget[],
  body: Record<string, unknown>,
  freeTimeout: number,
  outer?: AbortSignal,
): Promise<Attempt | null> {
  const targets = [...list];
  let last: Attempt | null = null;
  for (let index = 0; index < targets.length; index += 1) {
    if (outer?.aborted) return last;
    const target = targets[index];
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(target.free ? freeTimeout : 45_000);
      response = await fetch(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify({ ...(target.free ? freeBody(body) : body), model: target.model }),
        signal: outer ? AbortSignal.any([timeout, outer]) : timeout,
      });
    } catch (e) {
      if (outer?.aborted) return last;
      console.warn(`AI ${target.provider}/${target.model} network error`, e);
      // A free model that timed out on one key is just as slow on the next.
      if (target.free) {
        for (let j = index + 1; j < targets.length; j += 1) {
          if (targets[j].free && targets[j].model === target.model) targets.splice(j--, 1);
        }
      }
      continue;
    }
    let fallThrough = target.free ? !response.ok : shouldFallThrough(response.status);
    // Free tiers sometimes return 200 with an empty/refused body — treat as a failure
    // so the next free provider gets a go instead of the user seeing "…".
    if (!fallThrough && target.free && !body.stream) {
      try {
        const text = await response.clone().text();
        const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
        if (!(j.choices?.[0]?.message?.content ?? "").trim()) fallThrough = true;
      } catch {
        fallThrough = true;
      }
    }
    if (!fallThrough) {
      // Chat responses are streamed back to the caller, so token counts aren't
      // available here — log the call itself (provider + model) instead.
      logAiUsage({ feature: "chat", provider: target.provider, model: target.model });
      return { response, provider: target.provider, ok: true };
    }
    last = { response, provider: target.provider, ok: false };
    if (index === targets.length - 1) break;
    console.warn(`AI ${target.provider}/${target.model} returned ${response.status}, falling back`);
    // Don't hammer the same provider: skip its other models after a 429, and
    // give it a breath. Other failures move on straight away.
    if (response.status === 429) {
      for (let j = index + 1; j < targets.length; j += 1) {
        if (targets[j].provider === target.provider && targets[j].free) targets.splice(j--, 1);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 200)));
    }
  }
  return last;
}

/** Runs `primary`; if it hasn't succeeded within `ms`, starts `backup` too. First success wins. */
async function hedged(
  primary: (signal: AbortSignal) => Promise<Attempt | null>,
  backup: (signal: AbortSignal) => Promise<Attempt | null>,
  ms: number,
): Promise<Attempt | null> {
  const a = new AbortController();
  const b = new AbortController();
  let backupRun: Promise<Attempt | null> | null = null;
  const startBackup = () => (backupRun ??= backup(b.signal));
  const p = primary(a.signal);
  const timer = new Promise<"hedge">((resolve) => setTimeout(() => resolve("hedge"), ms));
  const first = await Promise.race([p, timer]);
  if (first !== "hedge" && first?.ok) return first;
  const bRun = startBackup();
  const pOk = p.then((r) => (r?.ok ? { r, loser: b } : Promise.reject(r)));
  const bOk = bRun.then((r) => (r?.ok ? { r, loser: a } : Promise.reject(r)));
  try {
    const win = await Promise.any([pOk, bOk]);
    win.loser.abort();
    return win.r;
  } catch {
    // Neither worked: hand back the backup's answer (the paid tier's error), else the primary's.
    return (await bRun) ?? (await p);
  }
}

export async function fetchAiChat(
  body: Record<string, unknown>,
  affinity = "default",
  opts: AiChatOpts = {},
): Promise<{ response: Response; provider: AiChatTarget["provider"] }> {
  const { free, paid, pro } = await chatPlan(body, affinity, opts);
  // The Foul Mouth model gets 10s before Gemini takes over, so a slow free
  // tier never leaves the user hanging.
  const freeTimeout = opts.foulMouth ? FOUL_FREE_TIMEOUT_MS : FREE_TIMEOUT_MS;
  let result: Attempt | null;
  if (opts.foulMouth && !pro && free.length && paid.length && !body.stream) {
    result = await hedged(
      (signal) => tryTargets(free, body, freeTimeout, signal),
      (signal) => tryTargets(paid, body, freeTimeout, signal),
      aiTiming.foulHedgeMs,
    );
  } else {
    result = await tryTargets(pro ? [...paid, ...free] : [...free, ...paid], body, freeTimeout);
  }
  if (result) return { response: result.response, provider: result.provider };
  throw new Error("All AI providers are busy — try again in a moment.");
}

type StreamRun = {
  provider: AiChatTarget["provider"];
  model: string;
  /** Resolves true once the first words arrive, false if it fails first. */
  first: Promise<boolean>;
  /** The full text when the stream ends ("" on failure), and the HTTP status. */
  done: Promise<{ text: string; status: number }>;
  /** Start forwarding words (including any already received). */
  attach: (fn: (delta: string) => void) => void;
  abort: () => void;
};

/** Opens one streamed reply. Times out only while waiting for the first words. */
function openStream(
  target: AiChatTarget,
  body: Record<string, unknown>,
  firstWordsMs: number,
): StreamRun {
  const ctrl = new AbortController();
  const firstTimer = setTimeout(() => ctrl.abort(), firstWordsMs);
  // Hard stop for a stream that stalls halfway.
  const capTimer = setTimeout(() => ctrl.abort(), 120_000);
  const sink: { fn: ((d: string) => void) | null } = { fn: null };
  const buffered: string[] = [];
  let text = "";
  let markFirst!: (v: boolean) => void;
  const first = new Promise<boolean>((resolve) => (markFirst = resolve));
  const done = (async () => {
    let status = 0;
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify({
          ...(target.free ? freeBody(body) : body),
          model: target.model,
          stream: true,
        }),
        signal: ctrl.signal,
      });
      status = res.status;
      if (!res.ok || !res.body) return { text: "", status };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let delta = "";
          try {
            const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
            delta = j.choices?.[0]?.delta?.content ?? "";
          } catch {
            continue;
          }
          if (!delta) continue;
          if (!text) {
            clearTimeout(firstTimer);
            markFirst(true);
          }
          text += delta;
          if (sink.fn) sink.fn(delta);
          else buffered.push(delta);
        }
      }
      return { text, status };
    } catch {
      return { text, status };
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(capTimer);
      markFirst(!!text);
    }
  })();
  return {
    provider: target.provider,
    model: target.model,
    first,
    done,
    attach: (fn) => {
      for (const d of buffered) fn(d);
      buffered.length = 0;
      sink.fn = fn;
    },
    abort: () => ctrl.abort(),
  };
}

/**
 * Same routing as fetchAiChat, but streams the reply: `onDelta` gets each new
 * piece of text as it's written. Falls over to the next model only before the
 * first words arrive. Returns the full text.
 */
export async function streamAiChat(
  body: Record<string, unknown>,
  affinity: string,
  opts: AiChatOpts,
  onDelta: (delta: string) => void,
): Promise<{ text: string; provider: AiChatTarget["provider"] }> {
  const { free, paid, pro } = await chatPlan(body, affinity, opts);
  const freeTimeout = opts.foulMouth ? FOUL_FREE_TIMEOUT_MS : FREE_TIMEOUT_MS;
  const targets = pro ? [...paid, ...free] : [...free, ...paid];
  const waitFor = (t: AiChatTarget) => (t.free ? freeTimeout : 45_000);
  let lastStatus = 0;

  const finish = async (run: StreamRun) => {
    run.attach(onDelta);
    const { text } = await run.done;
    logAiUsage({ feature: "chat", provider: run.provider, model: run.model });
    return { text, provider: run.provider };
  };

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const run = openStream(target, body, waitFor(target));
    // Foul Mouth: a slow swearing model gets Gemini running alongside it.
    const hedgeTarget =
      opts.foulMouth && target.free && !pro ? targets.slice(i + 1).find((t) => !t.free) : undefined;
    if (hedgeTarget) {
      const hedge = await Promise.race([
        run.first.then((ok) => (ok ? "primary" : "primary-failed")),
        new Promise<"hedge">((resolve) => setTimeout(() => resolve("hedge"), aiTiming.foulHedgeMs)),
      ]);
      if (hedge === "primary") return finish(run);
      if (hedge === "hedge") {
        const backup = openStream(hedgeTarget, body, waitFor(hedgeTarget));
        const winner = await Promise.any([
          run.first.then((ok) => (ok ? run : Promise.reject())),
          backup.first.then((ok) => (ok ? backup : Promise.reject())),
        ]).catch(() => null);
        if (winner) {
          (winner === run ? backup : run).abort();
          return finish(winner);
        }
        lastStatus = (await backup.done).status || lastStatus;
        // Both failed: carry on with whatever is left after the backup.
        const rest = targets.filter((t, j) => j > i && t !== hedgeTarget);
        targets.splice(i + 1, targets.length, ...rest);
        continue;
      }
    } else if (await run.first) {
      return finish(run);
    }
    const { status } = await run.done;
    lastStatus = status || lastStatus;
    console.warn(`AI stream ${target.provider}/${target.model} failed (${status}), falling back`);
    if (status === 429) {
      for (let j = i + 1; j < targets.length; j += 1) {
        if (targets[j].provider === target.provider && targets[j].free) targets.splice(j--, 1);
      }
    }
  }
  if (lastStatus === 429 || lastStatus === 402)
    throw new Error("OG B0T is rate-limited, try again soon.");
  throw new Error("All AI providers are busy — try again in a moment.");
}

export function needsLiveResearch(text: string): boolean {
  // Clear asks for fresh facts on their own...
  if (
    /(?:^\s*(?:\/research|research:)|\b(?:search the web|google (?:it|this|that)|look (?:it|this|that) up|latest|current news|breaking news|live scores?|final score|who won|who scored|current price|right now)\b)/i.test(
      text,
    )
  )
    return true;
  // ...or a time word next to something that changes day to day. Plain
  // "how are you today" stays offline, so the paid search isn't wasted.
  return (
    /\b(?:today|tonight|yesterday|this (?:week|weekend|morning|season))'?s?\b/i.test(text) &&
    /\b(?:match|game|fixture|score|result|won|win|beat|lost|lose|draw|news|price|weather|race|fight|election|transfer|happened|kick[- ]?off|odds)\w*\b/i.test(
      text,
    )
  );
}

const SEARCH_TIMEOUT_MS = 8_000;

type GroundedReply = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

/**
 * Live facts for OG Bot: Gemini answers with Google Search grounding turned on
 * and we hand its summary (plus the sites it read) to the chat model. Uses the
 * Boss's existing Gemini key. Returns null on any failure so chat carries on.
 */
export async function getLiveResearchContext(query: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const cleaned = query
    .replace(/^\s*(?:\/research|research:)\s*/i, "")
    .trim()
    .slice(0, 500);
  if (!cleaned) return null;
  const model = process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const today = new Date().toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Today is ${today} (UK time). Search the web and give concise factual bullet points (scores, prices, dates, names) for: ${cleaned}`,
                },
              ],
            },
          ],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      },
    );
  } catch (e) {
    console.warn("Live search failed", (e as Error).message);
    return null;
  }
  if (!res.ok) {
    console.warn("Live search failed", res.status);
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as GroundedReply;
  logAiUsage({
    feature: "live_search",
    provider: "gemini",
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  });
  const cand = json.candidates?.[0];
  const summary = (cand?.content?.parts ?? [])
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
  if (!summary) return null;
  const seen = new Set<string>();
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web?.title?.trim())
    .filter((t): t is string => !!t && !seen.has(t) && !!seen.add(t))
    .slice(0, 5);
  return sources.length ? `${summary}\n\nSources: ${sources.join(", ")}` : summary;
}

/**
 * Wraps the user's question with live facts. OG Bot keeps its full persona
 * (same voice, slang and Foul Mouth setting); only the facts are pinned down.
 */
export function liveFactsMessage(research: string, question: string): string {
  return `CURRENT WEB SOURCES (live Google search, ${new Date().toISOString().slice(0, 10)}):
${research}

USER QUESTION:
${question}

Answer in your normal OG B0T voice: same persona, slang and attitude as always (have a laugh at the losing team or the coin that dumped). Use only the relevant facts above and keep every score, price, date and name exactly as given. Mention a source by name if it helps. If the sources don't answer the question, say so instead of guessing.`;
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
