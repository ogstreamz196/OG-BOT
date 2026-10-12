// Promotional signature added to generated tracks.
//
// Rules:
// - Always in English, regardless of the song language (it is a brand name).
// - Exactly once, as the closing line at the very end of the track.
// - VIP members get clean tracks with no signature at all (decided by caller).

// Written as a real lyric line (not a parenthesised direction) so the engine
// actually sings it — parenthesised text is treated as optional ad-libs.
export const SIGNATURE_LINE = "[Closing tag]\nThis track was made by O G Bot dot co dot uk";

// A cappella variant: same sung words, voice only.
export const SIGNATURE_LINE_ACAPPELLA =
  "[Closing tag, voice only]\nThis track was made by O G Bot dot co dot uk";

/** Instruction appended to prompt-only (non-custom) generations. */
export const SIGNATURE_PROMPT_HINT =
  'Include ONE short, clearly audible vocal tag saying "this track was made by O G Bot dot co dot uk" in English, only once, at the very end of the track after the final lyric. Never repeat it anywhere else.';

/**
 * Append the signature exactly once, as the final line of the lyric sheet.
 * Returns the original text unchanged when there is nothing to tag.
 */
export function injectSignature(
  lyrics: string | null | undefined,
  opts?: { acappella?: boolean },
): string | null {
  const text = (lyrics ?? "").trim();
  if (!text) return lyrics ?? null;
  if (text.toLowerCase().includes("o g bot dot co dot uk")) return text;
  const tagLine = opts?.acappella ? SIGNATURE_LINE_ACAPPELLA : SIGNATURE_LINE;
  return `${text}\n\n${tagLine}`;
}

/** Append the signature hint to a free-form prompt (no lyric sheet supplied). */
export function withSignatureHint(prompt: string): string {
  if (!prompt.trim()) return prompt;
  if (prompt.toLowerCase().includes("o g bot dot co dot uk")) return prompt;
  return `${prompt}\n\n${SIGNATURE_PROMPT_HINT}`;
}
