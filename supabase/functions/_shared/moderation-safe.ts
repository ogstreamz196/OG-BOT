// Suno's moderation rejects explicit prompts with
// "Prompt contained inappropriate material". Foul Mouth tracks trip this a lot.
//
// Rather than failing the user's generation outright, we soften the text once
// and resubmit: strong profanity and slurs are swapped for milder stand-ins
// that keep the cadence and attitude of the line.

type Rep = string | ((m: string) => string);

const REPLACEMENTS: Array<[RegExp, Rep]> = [
  [/\bmother\s*f+u+c+k+\w*/gi, "mother trucker"],
  [
    /\bf+u+c+k+(ing|ed|er|ers|in['’]?)?\b/gi,
    (m: string) => (/ing|in['’]?$/i.test(m) ? "freaking" : "heck"),
  ],
  [/\bc+u+n+t+s?\b/gi, "clown"],
  [/\bn+i+g+(a|er|ga|gas|gers)\b/gi, "fam"],
  [/\bb+i+t+c+h+(es|ing)?\b/gi, "brat"],
  [/\bw+h+o+r+e+s?\b/gi, "faker"],
  [/\bs+l+u+t+s?\b/gi, "faker"],
  [/\bd+i+c+k+(head|heads)?\b/gi, "muppet"],
  [/\bp+u+s+s+y+\b/gi, "softie"],
  [/\bc+o+c+k+s?\b/gi, "muppet"],
  [/\btwats?\b/gi, "muppet"],
  [/\bwankers?\b/gi, "muppet"],
  [/\bprick(s)?\b/gi, "muppet"],
  [/\bbastard(s)?\b/gi, "chancer"],
  [/\bs+h+i+t+(e|ty|ting)?\b/gi, "trash"],
  [/\barse(hole|holes)?\b/gi, "clown"],
  [/\bass(hole|holes)\b/gi, "clown"],
  [/\bgimp(s)?\b/gi, "clown"],
  [/\bretard(ed|s)?\b/gi, "clueless"],
  [/\bfag(got|gots|s)?\b/gi, "clown"],
  [/\bra+pe\w*\b/gi, "wreck"],
  [/\bkill (him|her|them|you)\b/gi, "bury $1 on the track"],
];

/** Replace explicit language with milder stand-ins. Returns null for null input. */
export function softenForModeration(text: string | null): string | null {
  if (!text) return text;
  let out = text;
  for (const [re, rep] of REPLACEMENTS) {
    out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep);
  }
  return out;
}

/** True when a Suno error message indicates a content-moderation rejection. */
export function isModerationRejection(msg: string | null | undefined): boolean {
  const m = (msg ?? "").toLowerCase();
  return (
    m.includes("inappropriate") ||
    m.includes("content policy") ||
    m.includes("moderation") ||
    m.includes("violat")
  );
}

/** User-facing explanation shown in the app when moderation blocks a track. */
export const MODERATION_MESSAGE =
  "The music engine blocked these lyrics under its content rules. Your wording was not changed. Edit the lyrics or lower Foul Mouth and try again — any generation charge was refunded.";
