// Shared, browser-safe helpers for the Sports Guide feed.
export const SPORTS_GUIDE_CHAT_ID = -1002011722570;
export const SPORTS_GUIDE_USERNAME = "OGSPORTSGUIDE";

export const SPORT_CATEGORIES = [
  { id: "all", label: "All", emoji: "🔥" },
  { id: "football", label: "Football", emoji: "⚽" },
  { id: "fight", label: "UFC / Boxing", emoji: "🥊" },
  { id: "f1", label: "F1 / Motor", emoji: "🏎️" },
  { id: "darts", label: "Darts", emoji: "🎯" },
  { id: "basketball", label: "Basketball", emoji: "🏀" },
  { id: "tennis", label: "Tennis", emoji: "🎾" },
  { id: "cricket", label: "Cricket", emoji: "🏏" },
  { id: "general", label: "Other", emoji: "📺" },
] as const;

const RULES: [string, RegExp][] = [
  ["fight", /\b(ufc|boxing|mma|fight night|bout|undercard|wbc|wba|ibf|wbo|pfl|bellator|kickboxing|wrestling|wwe)\b/i],
  ["f1", /\b(f1|formula ?1|grand prix|motogp|nascar|indycar|qualifying)\b/i],
  ["darts", /\b(darts|pdc|premier league darts)\b/i],
  ["basketball", /\b(nba|basketball|euroleague)\b/i],
  ["tennis", /\b(tennis|atp|wta|wimbledon|us open|roland garros)\b/i],
  ["cricket", /\b(cricket|ipl|t20|odi|test match|the hundred)\b/i],
  ["football", /\b(football|soccer|premier league|epl|la ?liga|serie a|bundesliga|ligue 1|champions league|ucl|europa|fa cup|efl|vs\.?|v\.?)\b/i],
];

export function detectSport(text: string): string {
  for (const [id, re] of RULES) if (re.test(text)) return id;
  return "general";
}

export function detectEventTime(text: string): string | null {
  const m = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// Search aliases: what users type -> extra words to match.
export const SEARCH_ALIASES: Record<string, string[]> = {
  ucl: ["champions league"],
  pl: ["premier league"],
  epl: ["premier league"],
  mma: ["ufc"],
  ufc: ["mma"],
  f1: ["formula 1", "grand prix"],
  utd: ["united"],
  "man u": ["manchester united", "man utd"],
  spurs: ["tottenham"],
};

export function expandQuery(q: string): string[] {
  const base = q.trim().toLowerCase();
  if (!base) return [];
  return [base, ...(SEARCH_ALIASES[base] ?? [])];
}
