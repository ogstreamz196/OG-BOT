// A cheap self-check for replies built on live data (trade signals, football
// stats, web search): every hard figure in the reply must appear somewhere in
// what the model was given. Done in code, so it costs nothing unless it fails.

/** Scores like 2-1, prices like 2650.40, percentages, and numbers of 100+. */
const FIGURE_RE =
  /\b\d+\s?[-–]\s?\d+\b|\d[\d,]*\.\d+|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/g;

function normalise(fig: string): string {
  const t = fig.replace(/\s/g, "").replace(/–/g, "-");
  if (/^\d+-\d+$/.test(t)) return t;
  if (t.endsWith("%")) return `${Number.parseFloat(t)}%`;
  const n = Number.parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : t;
}

function figures(text: string): string[] {
  return (text.match(FIGURE_RE) ?? []).map(normalise);
}

const isYear = (f: string) => /^(19|20)\d\d$/.test(f);

/**
 * Figures in the reply that appear nowhere in the sources. A percentage also
 * counts as supported when the same number appears without the % sign.
 */
export function unsupportedFigures(reply: string, sources: string[]): string[] {
  const known = new Set<string>();
  for (const s of sources) {
    for (const f of figures(s)) {
      known.add(f);
      if (f.endsWith("%")) known.add(f.slice(0, -1));
    }
    // Plain numbers too, so "62" in "Confidence: 62% " backs "62%".
    for (const m of s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) known.add(normalise(m));
  }
  const out = new Set<string>();
  for (const f of figures(reply)) {
    if (isYear(f) || known.has(f)) continue;
    if (f.endsWith("%") && known.has(f.slice(0, -1))) continue;
    if (/^\d+-\d+$/.test(f)) {
      // A score can be written either way round ("lost 1-2" vs "2-1").
      const [a, b] = f.split("-");
      if (known.has(`${b}-${a}`)) continue;
    }
    out.add(f);
  }
  return [...out];
}

/** The note sent back to the model when its draft has unsupported figures. */
export function factCheckNote(bad: string[]): string {
  return `FACT CHECK: your draft used figures that are not in the data you were given: ${bad.join(", ")}. Rewrite the same reply in exactly the same voice and length, using only figures from the data. Do not mention this check.`;
}
