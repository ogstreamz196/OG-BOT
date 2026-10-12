// Last-resort songwriter: when every AI key is down, build complete, singable
// lyrics from the user's own name, story and styles with zero network calls,
// so a song can always be made.
type Input = {
  title: string; subject: string; story: string; styles: string[];
  foulMouth: boolean; foulIntensity: number; minLines: number;
};

const pick = <T,>(a: T[], i: number) => a[Math.abs(i) % a.length];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

const CLEAN = ["proper", "legend", "top tier", "no cap", "on form", "certified"];
const FOUL = [["bloody", "cheeky sod", "daft prat"], ["bloody", "bastard good", "piss easy"],
  ["fucking", "shit hot", "bollocks to the haters"], ["fucking", "shit hot", "fuck the haters"]];

export function fallbackLyrics(i: Input): string {
  const name = (i.subject || i.title || "you").split(/\s+/)[0];
  const seed = hash(name + i.story + i.styles.join());
  const slang = i.foulMouth ? FOUL[Math.min(3, Math.max(0, i.foulIntensity))] : CLEAN;
  const facts = i.story.split(/[.,;!\n]+/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 8);
  while (facts.length < 4) facts.push(pick(["always shows up when it counts", "lights up every room", "keeps it real with the crew", "never folds under pressure"], facts.length + seed));
  const vibe = i.styles[0] || "the beat";
  const hook = [
    `${name}, ${name}, yeah the whole town knows`,
    `${pick(slang, seed)} from the top down to the toes`,
    `Turn ${vibe} up, let the story unfold`,
    `${name} runs it — that's the way it goes`,
  ];
  const verse = (n: number) => facts.flatMap((f, k) => [
    `${name} ${f.charAt(0).toLowerCase()}${f.slice(1)}`,
    pick([`and every single day it's ${pick(slang, seed + k + n)}`, `no one does it quite like that`, `ask anyone, they'll tell you that`, `that's the truth, I'm standing by that`], seed + k * 3 + n),
  ]).slice(0, 8);
  const sections: string[] = [];
  let v = 0;
  const push = (label: string, lines: string[]) => sections.push(`[${label}]\n${lines.join("\n")}`);
  push("Intro", [`This one's for ${name}`, `Turn it up`]);
  while (sections.join("\n").split("\n").length < i.minLines + 6 && v < 6) {
    v++;
    push(`Verse ${v}`, verse(v));
    push("Chorus", hook);
    if (v === 2) push("Bridge", [`When the lights go low and the night gets cold`, `${name} still shining, never getting old`, `Every word I'm saying, let it be told`, `${pick(slang, seed + 9)} — pure gold`]);
  }
  push("Outro", [`${name} runs it`, `Yeah, ${name} runs it`]);
  return sections.join("\n\n");
}
