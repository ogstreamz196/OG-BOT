// OG B0T's trading desk: every free AI that's wired in reads the same live
// chart data, each with its own job, then a chief makes the final call.
//
// Wave 1: the Trend and Levels analysts read the chart. Wave 2: the Momentum
// and Risk analysts read it too, with wave 1's findings in front of them.
// The chief sees everything and picks BUY or SELL. Nobody is limited to their
// own job: each sees all the data and may use the others' findings; the job
// is only what they focus on.
//
// The AIs only choose a direction and explain it. Every price (entry, stop,
// targets) is still worked out in code, so pips and results stay exact.
// Only free tiers are used (free Google keys for the chief), never the paid
// Gemini key, and any failure falls back to the engine's own card.
import { freeFallbackTargets, type AiChatTarget } from "./ai-endpoint.server";

export type DeskLean = "BUY" | "SELL" | "WAIT";
export type DeskFinding = { role: DeskRoleId; lean: DeskLean; conviction: number; finding: string };
export type DeskDecision = {
  direction: "BUY" | "SELL";
  call: string;
  findings: DeskFinding[];
  /** No chief answered, so the analysts' weighted vote decided. */
  byVote?: boolean;
};

type DeskRoleId = "trend" | "levels" | "momentum" | "risk";
type DeskRole = { id: DeskRoleId; title: string; emoji: string; focus: string; model: RegExp };

export const DESK_ROLES: DeskRole[] = [
  {
    id: "trend",
    title: "Trend",
    emoji: "📈",
    focus:
      "the trend on every timeframe: EMAs (20/50/200), higher or lower highs and lows, and which way the bigger timeframe is pushing",
    model: /gpt-oss/,
  },
  {
    id: "levels",
    title: "Levels",
    emoji: "🧱",
    focus:
      "support, resistance and the recent highs and lows: where price is sitting, how much room it has to run, and whether the stop and targets are on sensible levels",
    model: /qwen/,
  },
  {
    id: "momentum",
    title: "Momentum",
    emoji: "⚡",
    focus:
      "RSI, MACD, ADX and volume: is the move just starting, still strong, or running out of steam right now",
    model: /nemotron/,
  },
  {
    id: "risk",
    title: "Risk",
    emoji: "📰",
    focus:
      "what could wreck the trade: high-impact news, the headlines, the trading session, choppy conditions and the cautions in the data",
    model: /openai-fast/,
  },
];

const CALL_TIMEOUT_MS = 8_000;
const DESK_BUDGET_MS = 22_000;
const GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** Free Google AI Studio keys, for the chief. */
function freeGeminiTargets(): AiChatTarget[] {
  return [
    "GEMINI_FREE_API_KEY",
    "GEMINI_FREE_BACKUP_API_KEY",
    "GEMINI_FREE_3_API_KEY",
    "GEMINI_FREE_4_API_KEY",
  ]
    .map((env) => process.env[env])
    .filter((k): k is string => !!k)
    .map((key) => ({
      url: GEMINI_OPENAI_URL,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      model: "gemini-flash-latest",
      provider: "gemini" as const,
      free: true,
    }));
}

/** Pulls the first {...} out of a model's reply. */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const oneLine = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);

async function ask(
  target: AiChatTarget,
  system: string,
  user: string,
  outer: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
  const res = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({
      model: target.model,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  return parseJsonReply(data?.choices?.[0]?.message?.content ?? "");
}

/** Tries the given targets in order until one answers with JSON. */
async function askAny(
  targets: AiChatTarget[],
  system: string,
  user: string,
  outer: AbortSignal,
): Promise<Record<string, unknown> | null> {
  for (const t of targets) {
    if (outer.aborted) return null;
    const out = await ask(t, system, user, outer).catch(() => null);
    if (out) return out;
  }
  return null;
}

/** Each role's preferred model first, then the rest of the free models. */
function rolesWithTargets(free: AiChatTarget[]) {
  return DESK_ROLES.map((role) => {
    const mine = free.filter((t) => role.model.test(t.model));
    const rest = free.filter((t) => !role.model.test(t.model));
    return { role, targets: [...mine, ...rest].slice(0, 3) };
  });
}

function analystPrompt(role: DeskRole, market: string): string {
  return (
    `You are the ${role.title} analyst on OG B0T's trading desk, reading ${market}. ` +
    `Your job is to focus on ${role.focus}. You can see all the chart data and any findings from the rest of the desk; use whatever helps. ` +
    `Say which way price is most likely to go in the next hour. Only use the numbers given; never invent prices. ` +
    `Reply with ONLY JSON: {"lean":"BUY"|"SELL"|"WAIT","conviction":0-100,"finding":"one plain sentence, max 22 words"}`
  );
}

const CHIEF_PROMPT = (market: string) =>
  `You are the chief of OG B0T's trading desk for ${market}. Your analysts have read the chart, each with their own job. ` +
  `Weigh their findings and the chart data and make the best-case call: BUY or SELL (you must pick one, never wait). ` +
  `Only use the numbers given; never invent prices. ` +
  `Reply with ONLY JSON: {"direction":"BUY"|"SELL","call":"one sentence, max 25 words, British, cheeky, saying why"}`;

function toFinding(role: DeskRoleId, v: Record<string, unknown> | null): DeskFinding | null {
  if (!v) return null;
  const lean = String(v.lean ?? "").toUpperCase();
  if (lean !== "BUY" && lean !== "SELL" && lean !== "WAIT") return null;
  const conviction = Math.max(0, Math.min(100, Math.round(Number(v.conviction) || 0)));
  const finding = oneLine(v.finding, 160);
  if (!finding) return null;
  return { role, lean, conviction, finding };
}

const findingsText = (fs: DeskFinding[]) =>
  fs
    .map((f) => {
      const title = DESK_ROLES.find((r) => r.id === f.role)!.title;
      return `- ${title} analyst: ${f.lean} (${f.conviction}% sure): ${f.finding}`;
    })
    .join("\n");

/**
 * Runs the desk on a market's chart data. Null when the desk can't decide
 * (no free models, all failed, or it ran out of time).
 */
export async function runDesk(market: string, chartData: string): Promise<DeskDecision | null> {
  const free = freeFallbackTargets(false);
  if (!free.length) return null;
  const outer = AbortSignal.timeout(DESK_BUDGET_MS);
  const roles = rolesWithTargets(free);
  const data = `CHART DATA\n${chartData.slice(0, 6000)}`;

  const wave = async (ids: DeskRoleId[], earlier: DeskFinding[]) =>
    (
      await Promise.all(
        roles
          .filter((r) => ids.includes(r.role.id))
          .map(async ({ role, targets }) =>
            toFinding(
              role.id,
              await askAny(
                targets,
                analystPrompt(role, market),
                earlier.length ? `${data}\n\nTHE DESK SO FAR\n${findingsText(earlier)}` : data,
                outer,
              ),
            ),
          ),
      )
    ).filter((f): f is DeskFinding => !!f);

  const first = await wave(["trend", "levels"], []);
  const second = await wave(["momentum", "risk"], first);
  const findings = [...first, ...second];
  if (!findings.length) return null;

  // The chief: free Google keys first, then the strongest free models.
  const chiefTargets = [
    ...freeGeminiTargets(),
    ...free.filter((t) => /gpt-oss/.test(t.model)),
    ...free.filter((t) => !/gpt-oss/.test(t.model)),
  ].slice(0, 4);
  const verdict = await askAny(
    chiefTargets,
    CHIEF_PROMPT(market),
    `${data}\n\nYOUR ANALYSTS\n${findingsText(findings)}`,
    outer,
  );
  let direction = String(verdict?.direction ?? "").toUpperCase();
  let call = oneLine(verdict?.call, 180);
  let byVote = false;
  if (direction !== "BUY" && direction !== "SELL") {
    byVote = true;
    // No chief: the desk's weighted vote decides.
    const score = findings.reduce(
      (n, f) => n + (f.lean === "BUY" ? f.conviction : f.lean === "SELL" ? -f.conviction : 0),
      0,
    );
    if (score === 0) return null;
    direction = score > 0 ? "BUY" : "SELL";
    call = "The desk's vote, weighed by how sure each analyst is.";
  }
  return { direction: direction as "BUY" | "SELL", call, findings, ...(byVote ? { byVote } : {}) };
}

/** The desk's lines for the card. */
export function deskLines(d: DeskDecision): string[] {
  return [
    "🧠 OG DESK",
    ...d.findings.map((f) => {
      const role = DESK_ROLES.find((r) => r.id === f.role)!;
      return `${role.emoji} ${role.title}: ${f.lean} · ${f.finding}`;
    }),
    `👑 Chief's call: ${d.direction}${d.call ? ` · ${d.call}` : ""}`,
  ];
}

/** Analysts who must answer before the desk counts as unanimous. */
export const DESK_MIN_AGREEING = 3;

/**
 * Every AI on the desk agrees: at least DESK_MIN_AGREEING analysts answered,
 * every one of them leans the chief's way (none says wait), and the chief made
 * the call (not the fallback vote).
 */
export function deskAgrees(d: DeskDecision | null): boolean {
  if (!d || d.byVote) return false;
  return d.findings.length >= DESK_MIN_AGREEING && d.findings.every((f) => f.lean === d.direction);
}
