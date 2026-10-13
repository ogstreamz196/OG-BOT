/**
 * Banter names for Battle Zone guests, in OG Bot's foul-mouth British style.
 * Plain data only: the name is the guest's display name, and OG Bot roasts
 * it through its existing prompts. Same guest id → same name every time.
 */
const FIRST = [
  "Silly",
  "Sausage",
  "Mama's",
  "Hairy",
  "Soggy",
  "Wonky",
  "Greasy",
  "Dodgy",
  "Crusty",
  "Moist",
  "Lardy",
  "Gormless",
  "Daft",
  "Manky",
  "Sweaty",
  "Wobbly",
  "Minging",
  "Clammy",
  "Saggy",
  "Stinky",
  "Nana's",
  "Lumpy",
  "Pasty",
  "Grotty",
  "Spotty",
  "Floppy",
  "Scabby",
  "Musty",
  "Budget",
  "Knock-off",
  "Half-baked",
  "Uncle's",
] as const;

const SECOND = [
  "Prick",
  "Monkey",
  "Noodle",
  "Snowflake",
  "Muppet",
  "Plonker",
  "Melt",
  "Pillock",
  "Numpty",
  "Bellend",
  "Wally",
  "Turnip",
  "Crumpet",
  "Kipper",
  "Donut",
  "Sprout",
  "Nugget",
  "Gremlin",
  "Pudding",
  "Biscuit",
  "Weasel",
  "Trumpet",
  "Toerag",
  "Spud",
  "Bap",
  "Goblin",
  "Kebab",
  "Parsnip",
  "Haddock",
  "Teacake",
  "Scone",
  "Wombat",
] as const;

function hash(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0;
  }
  return (h ^ (h >>> 16)) >>> 0;
}

export function guestBattleName(guestId: string): string {
  const a = FIRST[hash(guestId, 7) % FIRST.length];
  const b = SECOND[hash(guestId, 131) % SECOND.length];
  return `${a} ${b}`;
}
