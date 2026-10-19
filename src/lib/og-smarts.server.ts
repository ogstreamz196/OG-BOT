// What makes OG Bot sharper than a plain chatbot, shared by the app chat and
// Telegram: memory of the member, football data worked out in code, live web
// facts, and a figures check before data-backed replies go out.
import { factCheckNote, unsupportedFigures } from "./fact-check";
import { buildFootballContext } from "./football-context.server";
import { loadMemories } from "./og-memory.server";

type AnyClient = { from: (t: string) => any };

/**
 * Starts everything at once so it loads alongside the rest of the reply.
 * Football questions use the football feed first; the paid web search only
 * runs when that has nothing. Trade signals carry their own data.
 */
export function startGrounding(
  admin: AnyClient,
  userId: string,
  text: string,
  isTrade: boolean,
): { memories: Promise<string[]>; football: Promise<string>; research: Promise<string | null> } {
  const memories = loadMemories(admin, userId);
  const football: Promise<string> = isTrade
    ? Promise.resolve("")
    : buildFootballContext(text).catch((e) => {
        console.warn("football context failed (soft):", (e as Error).message);
        return "";
      });
  const research: Promise<string | null> = isTrade
    ? Promise.resolve(null)
    : football.then(async (block) => {
        if (block) return null;
        const { needsLiveResearch, getLiveResearchContext } = await import("./ai-endpoint.server");
        if (!needsLiveResearch(text)) return null;
        return getLiveResearchContext(text).catch((e) => {
          console.warn("Live search failed (soft):", (e as Error).message);
          return null;
        });
      });
  return { memories, football, research };
}

/**
 * The self-check: if a data-backed draft quotes figures that aren't in the
 * data, ask for one rewrite and keep whichever version is cleaner.
 */
export async function checkFigures(
  draft: string,
  sources: string[],
  redo: (note: string) => Promise<string | null>,
): Promise<string> {
  const bad = unsupportedFigures(draft, sources);
  if (!bad.length) return draft;
  console.warn("fact check: unsupported figures", bad.join(", "));
  const second = await redo(factCheckNote(bad)).catch(() => null);
  if (!second) return draft;
  return unsupportedFigures(second, sources).length < bad.length ? second : draft;
}
