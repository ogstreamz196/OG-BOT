/**
 * Shared opener/closer bank for OG Bot (Telegram + web/in-app chat).
 * Each user is served unseen lines first; when a user exhausts a pool a cheap
 * background batch of fresh lines is generated and added for everyone.
 * Battle Zone does NOT use this — it stays fresh every message.
 */
import { freeFallbackTargets, aiChatTargets } from "@/lib/ai-endpoint.server";

export type CatchTone = "foul" | "cheeky" | "safe";
type Admin = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

const LOW_WATER = 2;
const refilling = new Set<string>();

const TONE_BRIEF: Record<CatchTone, string> = {
  foul: "savage, sweary British/London street banter (profanity allowed, no slurs, no threats)",
  cheeky: "cheeky, playful British slang with no swearing",
  safe: "friendly, polite and clean",
};

type Kind = "opener" | "closer" | "roast";
async function generateBatch(kind: Kind, tone: CatchTone): Promise<string[]> {
  const prompt = `Write 12 brand-new, varied ${kind === "opener" ? "OPENING lines (how a reply starts)" : kind === "closer" ? "SIGN-OFF lines (how a reply ends)" : "ROASTS / one-liner insults aimed at the user (affectionate mate-banter, original, funny, British)"} for OG Bot, a UK music & chat bot. Style: ${TONE_BRIEF[tone]}. Each under ${kind === "roast" ? 18 : 10} words, all different structures, no numbering, no quotes, never "here we go you impatient dickhead". Output one per line, nothing else.`;
  for (const t of [...freeFallbackTargets(), ...aiChatTargets("catchphrases")]) {
    try {
      const res = await fetch(t.url, {
        method: "POST",
        headers: t.headers,
        body: JSON.stringify({ model: t.model, messages: [{ role: "user", content: prompt }], temperature: 1.1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const lines = (j.choices?.[0]?.message?.content ?? "")
        .split("\n")
        .map((l) => l.replace(/^[\s\-*\d.)"']+|["']+$/g, "").trim())
        .filter((l) => l.length >= 3 && l.length <= 120 && !/impatient dickhead/i.test(l));
      if (lines.length) return lines.slice(0, 12);
    } catch {
      /* try next provider */
    }
  }
  return [];
}

function refill(admin: Admin, kind: Kind, tone: CatchTone) {
  const key = `${kind}:${tone}`;
  if (refilling.has(key)) return;
  refilling.add(key);
  void (async () => {
    try {
      const phrases = await generateBatch(kind, tone);
      if (phrases.length) await admin.rpc("add_catchphrases", { p_kind: kind, p_tone: tone, p_phrases: phrases });
    } catch (e) {
      console.warn("catchphrase refill failed", e);
    } finally {
      refilling.delete(key);
    }
  })();
}

type Picked = { opener: string | null; closer: string | null; roasts?: string[] };

export async function pickCatchphrases(
  admin: Admin,
  userId: string,
  tone: CatchTone,
): Promise<Picked> {
  try {
    const [{ data, error }, roastRes] = await Promise.all([
      admin.rpc("pick_catchphrases", { p_user: userId, p_tone: tone }),
      admin.rpc("pick_roasts", { p_user: userId, p_tone: tone, p_n: 2 }),
    ]);
    const r = (roastRes.data ?? null) as { roasts?: string[]; left?: number } | null;
    const roasts = Array.isArray(r?.roasts) ? r!.roasts.filter(Boolean) : [];
    if (r && (r.left ?? 0) <= LOW_WATER) refill(admin, "roast", tone);
    if (error || !data) return { opener: null, closer: null, roasts };
    const d = data as { opener: string | null; closer: string | null; openers_left: number; closers_left: number };
    if ((d.openers_left ?? 0) <= LOW_WATER) refill(admin, "opener", tone);
    if ((d.closers_left ?? 0) <= LOW_WATER) refill(admin, "closer", tone);
    return { opener: d.opener, closer: d.closer, roasts };
  } catch {
    return { opener: null, closer: null, roasts: [] };
  }
}

/** Prompt note telling the model to use the picked lines instead of inventing its own. */
export function catchphraseNote(p: Picked): string {
  const roasts = p.roasts ?? [];
  if (!p.opener && !p.closer && !roasts.length) return "";
  const parts = ["\n\nBANTER INSPIRATION (optional — riff on these in your own words, don't paste them verbatim, don't force them as a fixed opener/closer):"];
  if (p.opener) parts.push(`- "${p.opener}"`);
  if (p.closer) parts.push(`- "${p.closer}"`);
  for (const r of roasts) parts.push(`- roast: "${r}"`);
  parts.push("- Spread the piss-taking naturally through the whole reply. Skip entirely if the user is upset or serious.");
  return parts.join("\n");
}

export function toneFor(mode: string, foulMouth: boolean): CatchTone {
  if (mode === "safe") return "safe";
  return foulMouth ? "foul" : "cheeky";
}
