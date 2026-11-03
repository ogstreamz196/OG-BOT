// How hard OG B0T swears in everyday chat (the Boss, 2026-11-03: "zero to
// 45% then cranks up or down according to the response from the user"; users
// never see a message about it). Each member starts somewhere between 0 and
// 45 (fixed per member, so it's consistent), then their own recent messages
// move it: swearing, cussing the bot and banter crank it up; politeness and
// plain chat bring it down slowly; anything sad or serious drops it right
// down. Worked out from the chat itself every time, so nothing is stored.
// Cuss battles (Battle Zone, group battles) don't use this: they stay savage.
// Pure.

/** The highest a member can start at (they start between 0 and this). */
export const START_MAX = 45;
/** How many of their latest messages count. */
const WINDOW = 12;

const SWEAR =
  /\b(fuck\w*|shit\w*|dickhead\w*|bollocks|bell-?end\w*|twat\w*|wank\w*|knob\w*|arse\w*|bastard\w*|prick\w*|gobshite|tosser|cock\w*|bloody|bugger\w*|piss\w*|cunt\w*|dick)\b/gi;
const AT_BOT =
  /\b(you(?:'re| are)?\s+(?:a\s+)?(?:\w+\s+)?(?:shit|crap|rubbish|useless|trash|mid|dead|weak|soft|prick|dickhead|muppet)|shut up|fuck (?:off|you)|come at me|bring it|go on then|cuss me|try me)\b/i;
const BANTER = /\b(lol|lmao|haha+|hehe|😂|🤣|💀|bruv|bro|mate|innit)\b|😂|🤣|💀/i;
const POLITE = /\b(please|thanks|thank you|cheers|appreciate|kindly)\b/i;
const SERIOUS =
  /\b(sad|depressed|depression|anxious|anxiety|died|passed away|funeral|grief|lonely|suicid\w*|self[- ]harm|crying|scared|stressed|panic|hospital|cancer|abuse)\b/i;

/** A member's starting point, 0..START_MAX, the same every time. */
export function startHeat(id: string | null | undefined): number {
  const s = id ?? "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % (START_MAX + 1);
}

/** How one of their messages moves the level. */
export function messageDelta(text: string): number {
  const t = text ?? "";
  if (SERIOUS.test(t)) return -40;
  const swears = (t.match(SWEAR) ?? []).length;
  let d = 0;
  if (swears) d += Math.min(24, swears * 12);
  if (AT_BOT.test(t)) d += 15;
  if (BANTER.test(t)) d += 4;
  if (POLITE.test(t) && !swears) d -= 8;
  // Plain chat drifts it gently back down.
  if (d === 0) d = -3;
  return d;
}

/** The level now (0..100) from their latest messages, oldest first. */
export function conversationHeat(id: string | null | undefined, userMessages: string[]): number {
  let h = startHeat(id);
  for (const m of userMessages.slice(-WINDOW)) h = Math.max(0, Math.min(100, h + messageDelta(m)));
  return h;
}

export type HeatBand = "clean" | "light" | "medium" | "savage";

export function heatBand(h: number): HeatBand {
  if (h <= 15) return "clean";
  if (h <= 45) return "light";
  if (h <= 75) return "medium";
  return "savage";
}

/** The line for the system prompt. Never shown to the member. */
export function heatNote(h: number): string {
  const band = heatBand(h);
  const how = {
    clean: "No swearing at all right now: cheeky and warm, British, but clean.",
    light:
      "Very light: at most one mild swear (bloody, sod it, bugger) now and then, often none. Light teasing only.",
    medium:
      "Medium: one or two natural swears where they land, light teasing. The answer still comes first.",
    savage:
      "They're going hard, so you can too: proper foul-mouthed banter and cussing, still helpful, never cruel or a slur.",
  }[band];
  return `SWEAR LEVEL ${h}/100 (secret, never mention it): ${how} Match their energy: if they swear or cuss you, go a bit harder; if they're polite, ease off; if they're upset or it's serious, no swearing at all.`;
}
