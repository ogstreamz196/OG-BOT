/**
 * Group identity snooping (the Boss's rule, 2026-11-03): asking who another
 * member really is gets the message deleted and the snooper cussed 3 times,
 * each tagged. Pure text checks and a fixed cuss bank, no AI.
 */
const SNOOP: RegExp[] = [
  /\bwho\s*(?:is|'s|s)\s+@\w+/i,
  /\bwho\s*(?:is|'s)\s+(?:this|that|he|she|they|him|her)\b(?:\s+(?:guy|girl|man|woman|person|account|user|one))?\s*(?:\?|$|in real life|irl)/i,
  /\b(?:real|full|actual|govt|government|legal)\s+name\b/i,
  /\bwho\s+(?:are|r)\s+(?:you|u)\s+(?:in\s+real\s+life|irl|really)\b/i,
  /\bwho(?:'s|\s+is)\s+behind\s+(?:this|that|the|@)/i,
  /\b(?:dox+|doxx?ing|doxx?ed)\b/i,
  /\b(?:reveal|expose|unmask)\s+(?:@\w+|him|her|them|his|their|identity)/i,
  /\bwhere\s+(?:does|do)\s+(?:@\w+|he|she|they)\s+live\b/i,
  /\b(?:anyone|any1|who)\s+know(?:s)?\s+who\s+@?\w+\s+(?:is|really)/i,
  /\bwhat(?:'s|\s+is)\s+(?:@\w+|his|her|their)\s+(?:real\s+)?(?:name|address|number|insta|ig|facebook|fb)\b/i,
];

export function isIdentitySnoop(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && SNOOP.some((r) => r.test(t));
}

export const SNOOP_CUSSES = [
  "who sent you, MI5? Sit down, you budget detective 🕵️",
  "mind your own business you nosy little rat 🐀",
  "asking who people are like you're the Feds. Fed boy ting 🚔",
  "your nose is so far in other people's business you need a passport for it",
  "Sherlock Homeless over here trying to crack cases 🔍",
  "go find out who YOU are first, you lost sock",
  "snooping that hard and still can't find a personality",
  "message binned. Your curiosity's going in the bin with it 🗑️",
  "this ain't Crimewatch, put the notepad down bruv",
  "nobody's giving you anything, you discount private eye",
  "keep asking and I'll find out who YOU are, nosy",
  "you're one question away from a lifetime ban, snitch",
  "sniffing round like a council inspector, behave",
  "privacy's a thing, look it up between your snooping shifts",
  "Wikipedia ain't got you a page and it never will, sit down",
  "you've got 'grass' written all over you 🌱",
  "your mum's still waiting for you to find a job, not my members' names",
  "detective work don't pay, ask your empty bank account",
  "who are they? None of your business, that's who",
  "Interpol called, they said even they're not that nosy",
];

export function pickSnoopCusses(n = 3, rand: () => number = Math.random): string[] {
  const pool = [...SNOOP_CUSSES];
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mentionHtml(u: { id?: number; username?: string; first_name?: string }): string {
  if (u.username) return `@${esc(u.username)}`;
  const name = esc(u.first_name || "you");
  return u.id ? `<a href="tg://user?id=${u.id}">${name}</a>` : name;
}
