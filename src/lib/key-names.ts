/**
 * The universal AI key names, the same in every OGSTREAMZ app (the Boss,
 * 2026-11-07): the free keys are FREE_<PROVIDER>_API_KEY (and _2, ...; free
 * Gemini is numbered from _1), and the paid Gemini key is PAID_GEMINI_F196.
 * Secrets saved under the old names still work: envKey() reads the new name
 * first, then the old one, so nothing breaks while the secrets are renamed.
 *
 * supabase/functions/_shared/key-names.ts is an identical copy for the edge
 * functions (a test checks they match). Never logs or returns a key's name
 * with its value.
 */

/** New name → the old names it replaces, checked in order. */
export const KEY_ALIASES: Record<string, string[]> = {
  FREE_GROQ_API_KEY: ["GROQ_API_KEY"],
  FREE_GROQ_API_KEY_2: ["GROQ_BACKUP_API_KEY"],
  FREE_OPENROUTER_API_KEY: ["OPENROUTER_API_KEY"],
  FREE_OPENROUTER_API_KEY_2: ["OPENROUTER_BACKUP_API_KEY"],
  FREE_POLLINATIONS_API_KEY: ["POLLINATIONS_API_KEY"],
  FREE_POLLINATIONS_API_KEY_2: ["POLLINATIONS_BACKUP_API_KEY"],
  FREE_GEMINI_API_KEY_1: ["GEMINI_FREE_API_KEY"],
  FREE_GEMINI_API_KEY_2: ["GEMINI_FREE_BACKUP_API_KEY"],
  FREE_GEMINI_API_KEY_3: ["GEMINI_FREE_3_API_KEY"],
  FREE_GEMINI_API_KEY_4: ["GEMINI_FREE_4_API_KEY"],
  PAID_GEMINI_F196: ["GEMINI_API_KEY"],
};

type Env = Record<string, string | undefined>;

const runtimeEnv = (): Env => {
  const g = globalThis as {
    process?: { env?: Env };
    Deno?: { env: { get(k: string): string | undefined } };
  };
  if (g.process?.env) return g.process.env;
  if (g.Deno) return new Proxy({}, { get: (_t, k) => g.Deno!.env.get(String(k)) }) as Env;
  return {};
};

/** A key by its universal name, falling back to its old name(s). Any other name reads as is. */
export function envKey(name: string, env: Env = runtimeEnv()): string | undefined {
  for (const n of [name, ...(KEY_ALIASES[name] ?? [])]) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}
