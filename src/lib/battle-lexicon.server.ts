/**
 * Battle Zone slang learning. OG Bot picks up words players use in roast
 * battles and recycles the popular ones. Only words are stored (no user ids).
 */
type Admin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>;
  from: (t: string) => any;
};

// Common English words we never "learn" — keeps the list to genuine slang.
const STOP = new Set(
  `the and you your you're youre are was were for that this with have has had not but what when where who why how
  its it's just like get got can cant can't don't dont will would could should about from they them their there then
  than been being into out off over under again more most some any all one two three ok okay yes yeah nah lol lmao
  haha mate bro bot ogbot og man men girl boy really very much well even still also back make made know think going
  gonna wanna say said tell told see look come came give take want need here now today time good bad big little
  him her his she he me my mine our ours we us i'm im ive i've let lets let's did does doing done yet way thing
  things stuff right wrong too why cause because only ever never always something nothing anything everything`
    .split(/\s+/)
    .filter(Boolean),
);

// Hard blocklist — slurs aimed at protected groups are never learned.
const BLOCK =
  /(nigg|fag|retard|tranny|paki|chink|spic|kike|gook|wetback|coon|dyke|raghead|towelhead|spastic|spaz)/i;

export function extractLearnableWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .match(/[a-z][a-z'-]{2,23}/g);
  if (!words) return [];
  return Array.from(new Set(words.filter((w) => !STOP.has(w) && !BLOCK.test(w)))).slice(0, 12);
}

export async function learnBattleWords(admin: Admin, text: string) {
  const words = extractLearnableWords(text);
  if (!words.length) return;
  try {
    await admin.rpc("learn_battle_words", { p_words: words });
  } catch (e) {
    console.warn("learn_battle_words failed", (e as Error).message);
  }
}

/** Popular community slang (used by many messages) for the prompt. */
export async function learnedSlangBlock(admin: Admin): Promise<string> {
  try {
    const { data } = await admin
      .from("battle_lexicon")
      .select("word, uses")
      .gte("uses", 3)
      .order("last_seen", { ascending: false })
      .limit(300);
    // Random sample of the growing vocabulary so every battle feels fresh.
    const pool = ((data ?? []) as { word: string }[])
      .map((r) => r.word)
      .filter((w) => !BLOCK.test(w) && !/weapon/.test(w));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const words = pool.slice(0, 30);
    if (!words.length) return "";
    return `\nSTREET SLANG LEARNED FROM THE BATTLE ZONE (players use these — weave a couple in naturally when they fit, never slurs): ${words.join(", ")}.`;
  } catch {
    return "";
  }
}
