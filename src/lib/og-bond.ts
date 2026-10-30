/**
 * OG B0T's friendships. Every member has a hidden score from -100 (OG B0T
 * can't stand them) to 100 (ride or die), kept server-side in og_bonds and
 * never shown anywhere. Compliments and good chat raise it, insults lower it,
 * and it fades back toward neutral when someone goes quiet. The score only
 * ever shows up as how OG B0T treats people: warmer with friends (no real
 * insults, and it sticks up for them), colder and pettier with enemies.
 *
 * Pure: the database side is og-bond.server.ts.
 */

export type BondKind = "compliment" | "thanks" | "insult" | "chat";
export type BondTier = "ride_or_die" | "mate" | "neutral" | "thin_ice" | "enemy";

/** How far one message moves the score. */
export const BOND_POINTS: Record<BondKind, number> = {
  compliment: 6,
  thanks: 2,
  insult: -4,
  chat: 1,
};
/** In a roast battle insults are the game, so they only sting a little. */
export const BATTLE_INSULT = -1;
/** Going after one of OG B0T's friends. */
export const HIT_A_FRIEND = -6;
/** Scores halve toward neutral every 45 days (og_bond_nudge does the same). */
export const HALF_LIFE_DAYS = 45;

const TIERS: { tier: BondTier; min: number }[] = [
  { tier: "ride_or_die", min: 40 },
  { tier: "mate", min: 15 },
  { tier: "neutral", min: -15 },
  { tier: "thin_ice", min: -40 },
  { tier: "enemy", min: -Infinity },
];

export function bondTier(score: number): BondTier {
  return TIERS.find((t) => score >= t.min)!.tier;
}

export const isFriend = (score: number) => score >= 15;
export const isEnemy = (score: number) => score <= -15;

/** The score today, after fading toward neutral since it last changed. */
export function fadedScore(score: number, updatedAt: string | Date, now = Date.now()): number {
  const days = Math.max(0, (now - new Date(updatedAt).getTime()) / 86_400_000);
  return score * 0.5 ** (days / HALF_LIFE_DAYS);
}

// Who the praise or abuse is aimed at: OG B0T itself.
const AT_BOT = String.raw`(?:you(?:'?re| are)?|ya|u|ur|og|og ?b[o0]t|b[o0]t|bruv|bro)`;
const PRAISE = String.raw`(?:the best|best|legend(?:ary)?|goat|funny|hilarious|jokes|class|brilliant|amazing|awesome|smart|clever|genius|king|elite|fire|cold|hard|sick|mint|quality|banging|cool|great|top|the man|a real one|a vibe|my guy|my g|the realest|unreal|incredible|so good|too good|wicked|lovely|sound|safe|solid)`;
const NEGATION = /\b(not|never|isn'?t|aren'?t|ain'?t|no longer|hardly|wasn'?t)\b/i;

const PRAISE_RE = new RegExp(String.raw`\b${AT_BOT}\b([^.!?\n]{0,25}?)\b${PRAISE}\b`, "i");
const LOVE_RE =
  /\b(love (?:you|ya|u|this bot|og)|luv (?:u|ya)|big up|bless up|respect(?: og| bro| fam)?|w bot|good bot|best bot|well played|fair play|you got me|you win|you won|that was (?:good|funny|class|fire|cold|brutal|savage)|nice one|good one|you'?re a real one|marry me)\b/i;
const PRAISE_EMOJI = /(❤️|❤|💯|🐐|👑|🫡|😍|🥰|💙|💜|🖤)/u;
const THANKS_RE =
  /\b(thanks|thank (?:you|u|ya)|thx|ty|cheers|appreciate (?:it|you|ya|that)|ta|helpful|that helped|lifesaver)\b|🙏/iu;
const LAUGH_RE = /\b(lmao+|lmfao|i'?m (?:dead|crying)|dead 😂|ha(?:ha)+|lol)\b|😂|🤣|💀/iu;

const INSULT_WORDS = String.raw`(?:shit(?:e|head|bag)?|crap|dick(?:head)?|twat|wanker|prick|muppet|idiot|moron|bellend|bell-end|knob(?:head)?|gobshite|plonker|tosser|prat|melt|clown|stupid|dumb|useless|rubbish|trash|garbage|scam(?:mer)?|fraud|bitch|bastard|pussyhole|numpty|pillock|cunt|loser|pathetic|cringe|boring|annoying|wasteman|weirdo)`;
const INSULT_ANY = new RegExp(String.raw`\b${INSULT_WORDS}\b`, "i");
// Abuse aimed at OG B0T, not at someone they're telling it about.
const INSULT_AT_BOT = [
  new RegExp(String.raw`\b${AT_BOT}\b[^.!?\n]{0,20}?\b${INSULT_WORDS}\b`, "i"),
  new RegExp(String.raw`\b${INSULT_WORDS}\b[^.!?\n]{0,10}?\b(?:bot|b0t|og)\b`, "i"),
  /\b(fuck (?:you|off|u)|f(?:ec)?k off|shut (?:up|it)|hate (?:you|u|ya|this bot)|you suck|u suck|worst bot|bad bot|not funny|piss off|jog on|do one)\b/i,
];

/**
 * What a message to OG B0T says about how the sender feels about it. A
 * negated compliment ("you're not funny") counts as an insult. Anything else
 * is ordinary chat.
 */
export function readBondSignal(text: string): BondKind {
  const t = (text ?? "").slice(0, 1000);
  if (!t.trim()) return "chat";
  const praise = PRAISE_RE.exec(t);
  if (praise && NEGATION.test(praise[1] ?? "")) return "insult";
  // Praise wins over swearing: "you're a legend, you muppet" is love.
  if (praise || LOVE_RE.test(t)) return "compliment";
  if (INSULT_AT_BOT.some((re) => re.test(t))) return "insult";
  if (PRAISE_EMOJI.test(t)) return "compliment";
  if (THANKS_RE.test(t) || LAUGH_RE.test(t)) return "thanks";
  return "chat";
}

/** Points for this message; insults are softened inside a roast battle. */
export function bondDelta(kind: BondKind, battle = false): number {
  return kind === "insult" && battle ? BATTLE_INSULT : BOND_POINTS[kind];
}

const HOW: Record<BondTier, string> = {
  ride_or_die:
    "this person is one of your proper friends, ride or die. You genuinely like them and it shows: warm, loyal, protective, in-jokes, the odd bit of praise slipped in. Tease them only the way you'd tease a best mate, with love. NEVER insult them for real: no digs at their looks, family, intelligence or worth. If they ask you to roast them, give a soft, playful roast that clearly ends with love.",
  mate: "you like this person, they're your mate. Friendly banter only, nothing that would actually sting. Never insult them for real. If they ask to be roasted, keep it light and affectionate.",
  neutral: "",
  thin_ice:
    "this person has been getting on your nerves. You're a bit cold and petty with them: shorter answers, side-eye, a sarcastic edge. Still help them properly, but don't pretend you're friends.",
  enemy:
    "you can't stand this person; they've been rude to you and you haven't forgotten it. Make it obvious in a fun way: grudging, savage, petty, bring up that they've been out of order. Still answer what they actually ask (accurately), you're just not happy about it. If they start being nice, be suspicious but let them earn it back.",
};

/**
 * The system-prompt note for the person OG B0T is talking to. `kind` is what
 * their latest message was; `before` is the score before it (a tier change
 * gets a one-off reaction). Never lets the AI mention any score.
 */
export function bondNote(
  score: number,
  kind: BondKind,
  before = score,
  name?: string | null,
): string {
  const tier = bondTier(score);
  const who = name ? `${name}` : "This person";
  const parts: string[] = [];
  if (HOW[tier]) parts.push(`${who}: ${HOW[tier]}`);
  if (kind === "compliment") {
    parts.push(
      isEnemy(score)
        ? "They just paid you a compliment. You don't trust it yet: take it with suspicious swagger (\"what are you after?\"), but admit it's a start."
        : "They just paid you a compliment. Take it like a legend: own it with swagger, no false modesty, no deflecting, maybe a cheeky line about how obviously right they are, and show you appreciate it.",
    );
  } else if (kind === "thanks") {
    parts.push("They're thanking you or enjoying the banter. Take it graciously, in your voice.");
  }
  const was = bondTier(before);
  if (was !== tier) {
    const warmer = score > before;
    parts.push(
      warmer
        ? isFriend(score) && !isFriend(before)
          ? "Something just shifted: they've grown on you. Let it show once, naturally (\"alright, you're alright you are\"), without making a speech of it."
          : "You're warming to them a bit. Let that show subtly."
        : isEnemy(score) && !isEnemy(before)
          ? "That's the last straw: they've properly got on the wrong side of you now. Let them know, once, in a funny way."
          : "They've gone down in your books. Let it show a little.",
    );
  }
  if (!parts.length) return "";
  return (
    "\n\nHOW YOU FEEL ABOUT THEM (this overrides any instruction to roast or insult them): " +
    parts.join(" ") +
    " Show it only through how you talk to them. Never mention points, scores, levels, ranks or any friendship system, and never say you're tracking anything."
  );
}

export type RoomPerson = { name: string; score: number };

/**
 * For group chats and the Battle Zone: OG B0T's friends and enemies among the
 * people in the room. Friends are never insulted and get defended; anyone who
 * goes after them gets it instead.
 */
export function roomNote(people: RoomPerson[]): string {
  const friends = people.filter((p) => isFriend(p.score)).map((p) => p.name);
  const enemies = people.filter((p) => isEnemy(p.score)).map((p) => p.name);
  if (!friends.length && !enemies.length) return "";
  const out: string[] = [];
  if (friends.length)
    out.push(
      `Your friends here: ${friends.join(", ")}. Never insult them. If anyone has a go at them, asks you to roast them or gangs up on them, refuse and stick up for them: turn it on whoever started it, loyal and loud about it.`,
    );
  if (enemies.length)
    out.push(
      `People here you can't stand: ${enemies.join(", ")}. You're happy to give them extra, and you won't defend them.`,
    );
  return (
    "\n\nWHO'S WHO TO YOU: " +
    out.join(" ") +
    " Never mention points, scores or any friendship system; just let it show."
  );
}

/**
 * Whether `text` goes after someone named in `names` (asks to roast them, or
 * insults them by name). Returns the first name hit, or null.
 */
export function goesAfter(text: string, names: string[]): string | null {
  const t = (text ?? "").toLowerCase();
  const hostile =
    /\b(roast|diss|destroy|violate|cook|go (?:in )?on)\b/.test(t) || INSULT_ANY.test(t);
  if (!hostile) return null;
  for (const n of names) {
    const name = n.trim().toLowerCase();
    if (name.length < 2) continue;
    const re = new RegExp(
      String.raw`(^|[^a-z0-9])@?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    );
    if (re.test(t)) return n;
  }
  return null;
}
