// Strips prompt/instruction leaks from AI-written lyrics before they are saved
// or sent to the music engine, so meta text is never sung. Works for every
// language/style: it only removes lines that talk about the rules themselves.
const META_LINE =
  /(english\s+(?:was|is)\s+not\s+selected|not\s+selected|language\s*(?:lock|rule|requirement)|no[- ]english|single[- ]language|multilingual\s+requirement|english\s+remix\s+requirement|strict\s+rule|critical\)|output\s+only|as\s+an\s+ai|here\s+(?:are|is)\s+(?:the|your)\s+(?:complete\s+)?lyrics|selected\s+language|section\s+markers?|\[\s*language\s*:)/i;

export function sanitizeLyrics(input: string | null | undefined): string {
  if (!input) return "";
  let text = input.replace(/```[a-z]*\n?/gi, "").replace(/\r/g, "");
  const lines = text.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (META_LINE.test(t)) return false;
    if (/^\*{0,2}(title|lyrics|note)\s*:/i.test(t) && !/^\[/.test(t)) return /^title/i.test(t);
    return true;
  });
  text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
