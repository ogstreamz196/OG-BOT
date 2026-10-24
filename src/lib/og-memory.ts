// OG Bot's long-term memory of a member: short facts they told it in private
// chat (football team, rap name, crypto they hold, the mate they roast). Pure
// helpers live here so they can be tested; storage is in og-memory.server.ts.

export const MAX_MEMORIES = 40;
export const MAX_FACT_LENGTH = 140;
const MAX_NEW_PER_MESSAGE = 3;

/**
 * Only messages where the member talks about themselves are worth a memory
 * check, which keeps the extra AI call off greetings and pure banter.
 */
export function shouldExtract(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 12) return false;
  return /\b(i|i'm|im|i've|ive|i'd|my|me|mine|call me|forget)\b/i.test(t);
}

/**
 * Never keep special-category or account-sensitive data, even if the member
 * offers it: health, religion, sexuality, politics, ethnicity, exact
 * addresses, contact details, card or bank numbers, passwords.
 */
export function isSensitive(fact: string): boolean {
  return (
    /\b(diagnos|illness|disease|cancer|hiv|depress|anxiety|adhd|autis|pregnan|disab|medication|therap|surgery|religio|muslim|christian|jewish|hindu|sikh|atheist|gay|lesbian|bisexual|trans(gender)?|sexuality|vote[sd]?|labour|tory|conservative|reform uk|ethnic|race|password|passcode|pin\b|sort code|account number|card number|cvv|postcode|home address|lives at|phone number|mobile number|email)\b/i.test(
      fact,
    ) ||
    /\d{5,}/.test(fact) ||
    /@\w/.test(fact)
  );
}

export type MemoryUpdate = { remember: string[]; forget: string[] };

/** Reads the extractor's JSON reply, dropping anything unsafe or malformed. */
export function parseMemoryUpdate(raw: string, existing: string[]): MemoryUpdate {
  const empty = { remember: [], forget: [] };
  const body = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = body.match(/\{[\s\S]*\}/);
  if (!match) return empty;
  let parsed: { remember?: unknown; forget?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return empty;
  }
  const known = new Set(existing.map((f) => f.toLowerCase()));
  const clean = (v: unknown) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\.$/, "") : "";
  const remember = (Array.isArray(parsed.remember) ? parsed.remember : [])
    .map(clean)
    .filter((f) => f.length >= 4 && f.length <= MAX_FACT_LENGTH)
    .filter((f) => !isSensitive(f) && !known.has(f.toLowerCase()))
    .filter((f, i, all) => all.findIndex((g) => g.toLowerCase() === f.toLowerCase()) === i)
    .slice(0, MAX_NEW_PER_MESSAGE);
  const forget = (Array.isArray(parsed.forget) ? parsed.forget : [])
    .map(clean)
    .filter((f) => known.has(f.toLowerCase()));
  return { remember, forget };
}

/** The extractor's instructions. Facts must be durable and about the member. */
export function extractorPrompt(existing: string[], userText: string): string {
  return `You keep OG B0T's notes about ONE member of a UK music and banter app.
Read their latest message and decide what is worth remembering long term.

Remember only lasting facts the member states about THEMSELVES: their nickname or rap name, the football team they support, where they're from (town or city only), job or studies, hobbies, music they like, crypto or markets they trade, people they mention by first name and who they are (e.g. "Dan is their mate they always roast"), running jokes, how they like to be spoken to.
Never remember: health, religion, sexuality, politics, ethnicity, exact addresses, phone numbers, emails, passwords, bank or card details, or anything about passing moods.
Write each fact in third person, short, under 120 characters, e.g. "Supports Spurs", "Rap name is Lil Bricks".
If the message says a saved fact is wrong or asks OG B0T to forget something, put that exact saved fact in "forget".

Saved facts:
${existing.length ? existing.map((f) => `- ${f}`).join("\n") : "(none yet)"}

Latest message:
"""${userText.slice(0, 1500)}"""

Reply with JSON only: {"remember": ["..."], "forget": ["..."]}. Use empty lists when there's nothing.`;
}

/** The block OG Bot sees in private chat. */
export function memoryNote(facts: string[]): string {
  if (!facts.length) return "";
  return `\n\nWHAT YOU REMEMBER ABOUT THIS MEMBER (from past chats, private to them):
${facts.map((f) => `- ${f}`).join("\n")}
Use these naturally when they fit (ammo for roasts, banter about their team, their coins), like a mate who remembers. Never list them back or say "my notes say". If they correct something, go with the correction.`;
}
