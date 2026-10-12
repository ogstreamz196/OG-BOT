/** Quantitative checks for English lyrics; never force English into other languages. */
const HARD = /\b(?:fuck\w*|motherfuck\w*|shit\w*|bullshit|bastard\w*|bitch\w*|cunt\w*|twat\w*|wanker\w*|prick\w*|dickhead\w*|arsehole\w*|asshole\w*|cockwomble\w*|knobhead\w*|bellend\w*|gobshite\w*)\b/gi;
const MILD = /\b(?:damn\w*|hell|bloody|piss\w*|bollocks|arse)\b/gi;

export function lyricIntensityIssue(text: string, level: number, englishOnly: boolean): string | null {
  if (!englishOnly) return null;
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line && !/^\[.*\]$/.test(line));
  const hard = lines.flatMap((line) => line.match(HARD) ?? []);
  const mild = lines.flatMap((line) => line.match(MILD) ?? []);
  if (level === 0) return hard.length + mild.length ? "Clean lyrics contain profanity." : null;
  if (level === 1) return hard.length || mild.length > 2 ? "Mild allows at most two mild swears and no strong profanity." : null;
  const explicitLines = lines.filter((line) => (line.match(HARD) ?? []).length > 0).length;
  const density = explicitLines / Math.max(1, lines.length);
  if (level === 2 && (density < 0.12 || density > 0.55)) return "Strong needs distinct explicit lines throughout, with plenty of clean lines between them.";
  if (level === 3 && (density < 0.65 || new Set(hard.map((word) => word.toLowerCase())).size < 4)) {
    return "Savage needs uncensored hard profanity in at least 65% of sung lines and at least four different hard swear words; mild insults alone do not qualify.";
  }
  return null;
}