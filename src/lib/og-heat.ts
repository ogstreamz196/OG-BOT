// How hard OG B0T swears in everyday chat (the Boss, 2026-11-03; users never
// see a message about it): it starts at 0, clean, like the friendly "I'm
// bored" messages. The first time a member swears or comes at the bot, it
// cusses (disses) them back at 45%; the second time it cracks up to 60%;
// every insult after that takes it higher, to 100. Politeness and plain chat
// bring it down slowly; anything sad or serious drops it straight to 0.
// Worked out from their latest messages every time, so nothing is stored.
// Cuss battles (Battle Zone, group battles) don't use this: they stay savage.
// Pure.

/** The level the first insult brings it to, then the second; each one after adds STEP. */
export const FIRST_CUSS = 45;
export const SECOND_CUSS = 60;
const STEP = 12;

/** How many of their latest messages count. */
const WINDOW = 12;

const SWEAR =
  /\b(fuck\w*|shit\w*|dickhead\w*|bollocks|bell-?end\w*|twat\w*|wank\w*|knob\w*|arse\w*|bastard\w*|prick\w*|gobshite|tosser|cock\w*|bloody|bugger\w*|piss\w*|cunt\w*|dick)\b/gi;
const AT_BOT =
  /\b(you(?:'re| are)?\s+(?:a\s+)?(?:\w+\s+)?(?:shit|crap|rubbish|useless|trash|mid|dead|weak|soft|prick|dickhead|muppet)|shut up|fuck (?:off|you)|come at me|bring it|go on then|cuss me|try me)\b/i;
const POLITE = /\b(please|thanks|thank you|cheers|appreciate|kindly)\b/i;
const SERIOUS =
  /\b(sad|depressed|depression|anxious|anxiety|died|passed away|funeral|grief|lonely|suicid\w*|self[- ]harm|crying|scared|stressed|panic|hospital|cancer|abuse)\b/i;

/** A message that swears or comes at the bot. */
export function isCuss(text: string): boolean {
  const t = text ?? "";
  return (t.match(SWEAR) ?? []).length > 0 || AT_BOT.test(t);
}

/**
 * The level now (0..100) from their latest messages, oldest first: 0 to
 * start; 45 at the first cuss, 60 at the second, then +12 for each one
 * after; polite chat eases it down 10, plain chat 3; sad or serious resets
 * it (and the count) to 0. The id is kept for callers; everyone starts at 0.
 */
export function conversationHeat(_id: string | null | undefined, userMessages: string[]): number {
  let h = 0;
  let cusses = 0;
  for (const m of userMessages.slice(-WINDOW)) {
    const t = m ?? "";
    if (SERIOUS.test(t)) {
      h = 0;
      cusses = 0;
    } else if (isCuss(t)) {
      cusses++;
      const target =
        cusses === 1 ? FIRST_CUSS : cusses === 2 ? SECOND_CUSS : SECOND_CUSS + (cusses - 2) * STEP;
      h = Math.min(100, Math.max(h, target));
    } else if (POLITE.test(t)) {
      h = Math.max(0, h - 10);
    } else {
      h = Math.max(0, h - 3);
    }
  }
  return h;
}

export type HeatBand = "clean" | "light" | "medium" | "savage";

export function heatBand(h: number): HeatBand {
  if (h <= 15) return "clean";
  if (h < FIRST_CUSS) return "light";
  if (h < 75) return "medium";
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
      "They've cussed you, so diss them back: a couple of natural swears and a proper jab at them, then still answer. Go a notch harder each time they keep it up.",
    savage:
      "They're going hard, so you can too: proper foul-mouthed banter and cussing, still helpful, never cruel or a slur.",
  }[band];
  return `SWEAR LEVEL ${h}/100 (secret, never mention it): ${how} Match their energy: if they swear or cuss you, go a bit harder; if they're polite, ease off; if they're upset or it's serious, no swearing at all.`;
}
