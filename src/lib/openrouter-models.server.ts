/**
 * Which OpenRouter free models OG B0T uses. OpenRouter adds and retires free
 * models often (its update at the start of November 2026 retired the one the
 * bot was built around, so every OpenRouter call failed), so nothing is
 * hard-coded: the bot reads OpenRouter's public model list (no key needed,
 * cached OR_CACHE_MS) and picks the best free chat models itself
 * (pickFreeModels). Until the list has loaded, or if it can't be read, it uses
 * OpenRouter's own free router, which always lands on a working free model.
 * OPENROUTER_FREE_MODEL (a secret, optional) puts one model first while it's
 * listed. Never throws.
 */

const MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OR_CACHE_MS = 6 * 3600_000;
/** OpenRouter's router that picks a working free model itself. */
export const OR_FREE_ROUTER = "openrouter/free";
/** How many free models the bot tries, best first, before the router. */
export const OR_PICKS = 2;

/** Free models meant for something other than chat. */
const NOT_CHAT =
  /safety|guard|moderat|code|coder|embed|rerank|reasoning|math|vision-only|tts|audio-only/i;

export type OrModel = {
  id: string;
  context_length?: number;
  created?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

/** Billions of parameters from an id like "...-120b-a12b:free" (the first figure), else null. Pure. */
export function paramsB(id: string): number | null {
  const m = /(\d+(?:\.\d+)?)b(?![a-z])/i.exec(id.replace(/:free$/, ""));
  return m ? Number(m[1]) : null;
}

/**
 * The free chat models worth using, best first. Pure.
 * Free (":free"), text in and out, meant for chat, at least 8B parameters
 * when the size is known; the biggest first, then the longest context, then
 * the newest. A preferred id goes first when it's listed.
 */
export function pickFreeModels(models: OrModel[], preferred?: string | null): string[] {
  const usable = models.filter((m) => {
    if (!m.id.endsWith(":free")) return false;
    const inputs = m.architecture?.input_modalities ?? ["text"];
    const outputs = m.architecture?.output_modalities ?? ["text"];
    if (!inputs.includes("text") || !outputs.includes("text")) return false;
    if (NOT_CHAT.test(m.id)) return false;
    const size = paramsB(m.id);
    return size === null || size >= 8;
  });
  const rank = (m: OrModel) => [paramsB(m.id) ?? 0, m.context_length ?? 0, m.created ?? 0];
  usable.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (y[i] !== x[i]) return y[i] - x[i];
    return a.id.localeCompare(b.id);
  });
  const ids = usable.map((m) => m.id);
  if (preferred && ids.includes(preferred))
    return [preferred, ...ids.filter((i) => i !== preferred)];
  return ids;
}

let cache: { at: number; picks: string[] } | null = null;
let loading: Promise<string[]> | null = null;

/** The free models to try now, best first, ending with OpenRouter's free router. Sync. */
export function openRouterFreeModels(): string[] {
  return [...(cache?.picks ?? []).slice(0, OR_PICKS), OR_FREE_ROUTER];
}

/** Reads OpenRouter's model list when the cache is stale. Never throws. */
export async function loadOpenRouterModels(now = Date.now()): Promise<string[]> {
  if (cache && now - cache.at < OR_CACHE_MS) return cache.picks;
  loading ??= (async () => {
    try {
      const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: OrModel[] };
      const picks = pickFreeModels(json.data ?? [], process.env.OPENROUTER_FREE_MODEL);
      // An empty list keeps the last good picks rather than none.
      cache = { at: now, picks: picks.length ? picks : (cache?.picks ?? []) };
    } catch {
      // Try again in ten minutes; meanwhile the last picks (or the router) stand.
      cache = { at: now - OR_CACHE_MS + 10 * 60_000, picks: cache?.picks ?? [] };
    } finally {
      loading = null;
    }
    return cache!.picks;
  })();
  return loading;
}

/** OpenRouter said a model isn't there (404): stop using it until the list says otherwise. */
export function openRouterModelGone(model: string) {
  if (cache && model !== OR_FREE_ROUTER)
    cache = { ...cache, picks: cache.picks.filter((m) => m !== model) };
}

/** For tests. */
export function forgetOpenRouterModels() {
  cache = null;
  loading = null;
}
