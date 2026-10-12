import { Disc3, Heart, Languages, Smile } from "lucide-react";

export type Category = "language" | "genre" | "mood" | "theme";

/** Most-picked languages — always shown first in every language selector. */
export const FAVOURITE_LANGUAGES = [
  "English",
  "Turkish",
  "Romanian",
  "Hindi",
  "Urdu",
  "Gujarati",
  "Spanish",
  "Arabic",
  "Filipino",
  "Punjabi",
];

/** Puts the favourites at the top of any language list, keeping the rest in order. */
export function orderLanguages(list: string[]): string[] {
  const favs = FAVOURITE_LANGUAGES.filter((l) => list.includes(l));
  return [...favs, ...list.filter((l) => !favs.includes(l))];
}

export const POOLS: Record<Category, string[]> = {
  language: orderLanguages([
    "English",
    "Albanian",
    "Spanish",
    "French",
    "German",
    "Italian",
    "Portuguese",
    "Japanese",
    "Korean",
    "Mandarin",
    "Hindi",
    "Gujarati",
    "Marathi",
    "Bengali",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Punjabi",
    "Urdu",
    "Arabic",
    "Swahili",
    "Yoruba",
    "Russian",
    "Turkish",
    "Romanian",
    "Dutch",
    "Greek",
    "Filipino",
    "Tagalog",
    "Lithuanian",
    "Polish",
    "Ukrainian",
    "Swedish",
    "Norwegian",
    "Danish",
    "Finnish",
    "Hungarian",
    "Czech",
    "Bulgarian",
    "Serbian",
    "Croatian",
    "Vietnamese",
    "Thai",
    "Indonesian",
    "Malay",
    "Somali",
    "Amharic",
    "Kurdish",
    "Persian",
    "Hebrew",
    "Pashto",
    "Nepali",
    "Sinhala",
    "Irish",
    "Welsh",
    "Zulu",
    "Hausa",
  ]),

  genre: [
    "Hip Hop",
    "Rap",
    "Singing",
    "Drill",
    "Trap",
    "Drum & Bass",
    "Afrobeats",
    "R&B",
    "Pop",
    "K-Pop",
    "Slow Jam",
    "Bhangra",
    "Nasheed",
    "Nursery Rhyme",
    "Dance",
    "Reggae",
    "Rock",
    "Indie",
    "House",
    "Lo-fi",
    "Country",
    "Jazz",
    "Funk",
    "Hyperpop",
    "Amapiano",
    "Dancehall",
    "Garage",
    "Bossa Nova",
    "Grime",
    "UK Drill",
    "Afro Trap",
    "Afro House",
    "Reggaeton",
    "Salsa",
    "Bachata",
    "Dubstep",
    "Techno",
    "Trance",
    "Jersey Club",
    "Phonk",
    "Synthwave",
    "Gospel",
    "Soul",
    "Blues",
    "Acoustic",
    "Folk",
    "Metal",
    "Punk",
    "Bollywood",
    "Qawwali",
    "Classical",
    "Cinematic",
    "Disco",
    "Emo Rap",
    "Boom Bap",
  ],

  mood: [
    "Happy & Upbeat",
    "Sad & Slow",
    "Angry & Hype",
    "Romantic & Chill",
    "Hype & Floor-filler",
    "Chill groove",
    "Melancholy & Slow burn",
    "Confident & Bouncy",
    "Heartbroken ballad",
    "Nostalgic & Mid-tempo",
    "Playful & Bouncy",
    "Dark & Half-time",
    "Hopeful & Upbeat",
    "Triumphant marching",
    "Dreamy & Slow",
    "Rebellious & Frenetic",
    "Bittersweet mid-tempo",
  ],
  theme: [
    "Love",
    "Heartbreak",
    "Money",
    "Party",
    "Family",
    "Revenge",
    "Friendship",
    "Hustle",
    "Loss",
    "Self-belief",
    "Summer nights",
    "City lights",
    "Late-night drive",
    "First crush",
    "Coming home",
    "Underdog story",
    "Toxic ex",
    "Glow-up",
  ],
};

export type CategoryMeta = {
  label: string;
  helper: string;
  placeholder: string;
  icon: typeof Languages;
  gradient: string;
  emoji: string;
  accent: string;
  chipActive: string;
  iconBg: string;
};

export const META: Record<Category, CategoryMeta> = {
  language: {
    label: "Language",
    helper: "What language do you want to sing in?",
    placeholder: "Pick a language",
    icon: Languages,
    gradient: "from-sky-500/50 via-cyan-500/25 to-transparent",
    emoji: "🌍",
    accent: "text-sky-300",
    chipActive:
      "border-sky-400 bg-sky-500/25 text-sky-100 shadow-[0_0_24px_-6px_theme(colors.sky.400)]",
    iconBg: "bg-sky-500/20 text-sky-300 border-sky-400/30",
  },
  genre: {
    label: "Genre",
    helper: "What sound are we cooking?",
    placeholder: "Pick a genre",
    icon: Disc3,
    gradient: "from-fuchsia-500/50 via-purple-500/25 to-transparent",
    emoji: "🎧",
    accent: "text-fuchsia-300",
    chipActive:
      "border-fuchsia-400 bg-fuchsia-500/25 text-fuchsia-100 shadow-[0_0_24px_-6px_theme(colors.fuchsia.400)]",
    iconBg: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/30",
  },
  mood: {
    label: "Mood & Tempo",
    helper: "How should it feel and move?",
    placeholder: "Pick a vibe",
    icon: Smile,
    gradient: "from-amber-500/50 via-orange-500/25 to-transparent",
    emoji: "✨",
    accent: "text-amber-300",
    chipActive:
      "border-amber-400 bg-amber-500/25 text-amber-100 shadow-[0_0_24px_-6px_theme(colors.amber.400)]",
    iconBg: "bg-amber-500/20 text-amber-300 border-amber-400/30",
  },
  theme: {
    label: "Theme",
    helper: "What's the song about?",
    placeholder: "Pick a theme",
    icon: Heart,
    gradient: "from-rose-500/50 via-pink-500/25 to-transparent",
    emoji: "💭",
    accent: "text-rose-300",
    chipActive:
      "border-rose-400 bg-rose-500/25 text-rose-100 shadow-[0_0_24px_-6px_theme(colors.rose.400)]",
    iconBg: "bg-rose-500/20 text-rose-300 border-rose-400/30",
  },
};

export const GENRE_MOOD_BIAS: Record<string, string[]> = {
  "Hip Hop": ["Confident", "Hype", "Nostalgic", "Rebellious"],
  Rap: ["Confident", "Angry", "Hype", "Rebellious"],
  Singing: ["Romantic", "Hopeful", "Heartbroken", "Dreamy"],
  Drill: ["Dark", "Angry", "Confident", "Rebellious"],
  Trap: ["Hype", "Confident", "Dark", "Triumphant"],
  "Drum & Bass": ["Hype", "Rebellious", "Confident", "Triumphant"],
  Afrobeats: ["Happy", "Hype", "Romantic", "Playful"],
  "R&B": ["Romantic", "Heartbroken", "Bittersweet", "Dreamy"],
  Pop: ["Happy", "Hopeful", "Playful", "Triumphant"],
  "K-Pop": ["Happy", "Hype", "Playful", "Confident"],
  "Slow Jam": ["Romantic", "Dreamy", "Heartbroken", "Chill"],
  Bhangra: ["Happy", "Hype", "Confident", "Triumphant"],
  Nasheed: ["Hopeful", "Triumphant", "Nostalgic"],
  "Nursery Rhyme": ["Happy", "Playful", "Hopeful"],
  Dance: ["Hype", "Happy", "Triumphant"],
  "Lo-fi": ["Chill", "Nostalgic", "Dreamy", "Melancholy"],
  Country: ["Nostalgic", "Hopeful", "Bittersweet"],
  Reggae: ["Chill", "Hopeful", "Playful"],
  Jazz: ["Romantic", "Melancholy", "Dreamy"],
  Amapiano: ["Hype", "Happy", "Confident"],
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type Selections = Partial<Record<Category, string>>;

export function pickFresh(
  cat: Category,
  exclude: Set<string>,
  count: number,
  context: Selections = {},
): string[] {
  const pool = POOLS[cat].filter((v) => !exclude.has(v));
  if (pool.length === 0) return [];
  if (cat === "mood" && context.genre && GENRE_MOOD_BIAS[context.genre]) {
    const preferred = GENRE_MOOD_BIAS[context.genre].filter((v) => !exclude.has(v));
    const rest = pool.filter((v) => !preferred.includes(v));
    return [...shuffle(preferred), ...shuffle(rest)].slice(0, count);
  }
  return shuffle(pool).slice(0, count);
}

export function initialChips(): Record<Category, string[]> {
  return {
    language: pickFresh("language", new Set(), 4),
    genre: pickFresh("genre", new Set(), 4),
    mood: pickFresh("mood", new Set(), 4),
    theme: pickFresh("theme", new Set(), 4),
  };
}

// --- "Surprise me" data ---------------------------------------------------

export const SURPRISE_TITLES: string[] = [
  "Late night drive",
  "Sunday hangover",
  "Gym warm-up",
  "Festival anthem",
  "Heartbreak letter",
  "Pirate radio cypher",
  "Summer rooftop",
  "Last train home",
  "Glow-up season",
  "City lights blur",
  "Toxic ex anthem",
  "Underdog story",
];

export const SURPRISE_TEMPLATES: string[] = [
  "Their name: Aaliyah\nOccasion: 30th birthday\nInside joke: still can't parallel park\nWhat they love: oat-milk lattes",
  'Their name: Marcus\nStory: ghosted me after 2 years\nCity: Manchester\nInside joke: "I\'ll text you back" — never did',
  "Their name: Sam & Jordan\nOccasion: wedding day\nWhat they love: late-night taco runs\nInside joke: the karaoke night we don't talk about",
  "Their name: Dre\nOccasion: promotion at work\nCity: Brooklyn\nWhat they love: never missing leg day",
];

export type PromptChip = { label: string; snippet: string };

export const EXAMPLE_PROMPT_CHIPS: PromptChip[] = [
  { label: "💛 Heart of gold", snippet: "They've got a heart of gold — " },
  { label: "🎉 Life of the party", snippet: "Always the life of the party — " },
  { label: "🫶 Always there for me", snippet: "Always there for me when — " },
  { label: "🔥 Total legend", snippet: "An absolute legend because — " },
];

export function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Personal details validator ------------------------------------------

export const PERSONAL_DETAILS_MAX = 500;

export type PersonalDetailsStatus = "empty" | "tiny" | "warn" | "good" | "near" | "full";

export type PersonalDetailsCheck = {
  status: PersonalDetailsStatus;
  message: string;
  /** 0..100 fill percentage. */
  pct: number;
  /** Tailwind text-color utility for status/counter. */
  tone: string;
  /** Tailwind bg-color utility for the progress bar. */
  barTone: string;
  length: number;
};

export function personalDetailsCheck(
  text: string,
  max = PERSONAL_DETAILS_MAX,
): PersonalDetailsCheck {
  const len = text.length;
  const trimmed = text.trim();
  const hasName = /name\s*[:-]/i.test(trimmed) || /^[A-Z][a-z]+/m.test(trimmed);
  const hasDetail = /(occasion|love|joke|story|city|place)\s*[:-]/i.test(trimmed);
  const pct = (len / max) * 100;

  let status: PersonalDetailsStatus;
  let message: string;
  if (len === 0) {
    status = "empty";
    message = "👆 Start with their name — then add anything that makes them them";
  } else if (len < 20) {
    status = "tiny";
    message = "Add a name and an occasion for best results";
  } else if (!hasName) {
    status = "warn";
    message = '💡 Add a name (e.g. "Their name: Aaliyah")';
  } else if (!hasDetail) {
    status = "warn";
    message = "💡 Add an occasion, love, or inside joke";
  } else if (len > max - 30) {
    status = "near";
    message = "Almost at the limit";
  } else {
    status = "good";
    message = "✓ Looking good — the more specific, the better";
  }
  if (len >= max) {
    status = "full";
    message = "Character limit reached";
  }

  const tone =
    status === "good"
      ? "text-emerald-400"
      : status === "warn" || status === "tiny"
        ? "text-amber-400"
        : status === "near" || status === "full"
          ? "text-destructive"
          : "text-muted-foreground";
  const barTone =
    status === "full" || status === "near"
      ? "bg-destructive"
      : status === "good"
        ? "bg-emerald-500"
        : status === "warn" || status === "tiny"
          ? "bg-amber-500"
          : "bg-primary/40";

  return { status, message, pct, tone, barTone, length: len };
}

/**
 * Pulls the language list back out of a saved brief/prompt.
 * Briefs carry a "Language: write the lyrics in English + Turkish" line, so
 * retries and re-submissions can restore the artist's picks without extra columns.
 */
export function languageFromPrompt(text: string | null | undefined): string | null {
  const m = text?.match(/Language:\s*(?:write the lyrics in\s*)?([^\n]+)/i);
  const found = m?.[1]?.trim();
  return found || null;
}

/** Styles free members can use; everything else needs OG VIP (or the trial). */
export const FREE_STYLES = ["Hip Hop", "Rap", "Pop", "R&B", "Lo-fi", "Nasheed"];
export const isFreeStyle = (s: string) => FREE_STYLES.includes(s);
