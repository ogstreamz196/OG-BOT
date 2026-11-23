// The clean-mode safety net (2026-11-23): when a member's foul mouth is off,
// or they aren't allowed it, OG B0T's chat reply has its strong swear words
// masked (f••k), in case an AI model swore anyway. The voice instructions ask
// for clean replies; this only catches what slips through. Chat replies only,
// never song lyrics, which follow the member's own "Language in your songs"
// setting. Pure.

/** The word starts that get masked (whole words only, any ending). */
const STRONG = [
  "motherfuck",
  "fuck",
  "shite",
  "shit",
  "cunt",
  "twat",
  "wank",
  "bollock",
  "bastard",
  "bitch",
  "dickhead",
  "arsehole",
  "asshole",
];
const RE = new RegExp(`(?<![A-Za-z])(${STRONG.join("|")})([A-Za-z]*)`, "gi");

/** The reply with strong swear words masked: the word start's first and last letters kept (f••k). Dots, not
 * asterisks: the website renders replies as Markdown, where ** would turn bold. */
export function maskSwears(text: string): string {
  return text.replace(RE, (_m, root: string, rest: string) => {
    return root[0] + "•".repeat(root.length - 2) + root[root.length - 1] + rest;
  });
}
