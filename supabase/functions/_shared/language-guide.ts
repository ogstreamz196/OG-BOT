// Per-language writing/pronunciation guidance. Lyrics are romanised, so close
// languages (Hindi vs Urdu, Punjabi, Gujarati) look alike on the page. These
// notes keep each language's own vocabulary and accent so the right one is sung.
const GUIDE: Record<string, { lyric: string; voice: string }> = {
  hindi: {
    lyric: "Hindi: everyday Hindi words with Hindi grammar (hai, hoon, mera, tera, dil, pyaar, zindagi, sapne). Prefer Hindi words over Persian/Arabic Urdu ones. Romanise it like Bollywood lyrics.",
    voice: "Hindi vocals, Bollywood-style Hindi pronunciation",
  },
  urdu: {
    lyric: "Urdu: Urdu vocabulary and poetic style (ishq, mohabbat, dil, khwaab, zindagi, sukoon, junoon, ghazal imagery). Prefer Persian/Arabic Urdu words over Sanskrit Hindi ones. Romanise it like Pakistani songs (e.g. 'mera dil', 'tum ho').",
    voice: "Urdu vocals, Pakistani Urdu pronunciation, soft ghazal-style diction",
  },
  punjabi: {
    lyric: "Punjabi: real Punjabi grammar and words (main, tu, mera/meri, ni, ve, jatt, gabru, kudi, sohni, yaar, kithe, hun). Never swap in Hindi grammar. Romanise it like Punjabi pop songs.",
    voice: "Punjabi vocals, Punjabi pronunciation and bhangra-style delivery",
  },
  gujarati: {
    lyric: "Gujarati: real Gujarati grammar and words (che, maru, taru, tame, hu, majama, kem cho, prem). Never write Hindi lines. Romanise it.",
    voice: "Gujarati vocals with native Gujarati pronunciation",
  },
  marathi: { lyric: "Marathi: real Marathi grammar (aahe, majha, tujha, kay, mi). Not Hindi.", voice: "Marathi vocals" },
  bengali: { lyric: "Bengali: real Bengali grammar (ami, tumi, amar, bhalobashi). Not Hindi.", voice: "Bengali vocals" },
  tamil: { lyric: "Tamil: real Tamil words (naan, nee, en, kadhal, vaa). Romanised.", voice: "Tamil vocals" },
  telugu: { lyric: "Telugu: real Telugu words (nenu, nuvvu, prema). Romanised.", voice: "Telugu vocals" },
  arabic: { lyric: "Arabic: Arabic words romanised (habibi, albi, ya, inta/inti, hayati). Not Urdu.", voice: "Arabic vocals with native Arabic pronunciation" },
  turkish: { lyric: "Turkish: real Turkish grammar and words (ben, sen, aşkım, kalbim, gel). Keep Turkish letters ç ş ğ ı ö ü.", voice: "Turkish vocals" },
  romanian: { lyric: "Romanian: real Romanian words (iubire, inima, te iubesc). Keep ă â î ș ț.", voice: "Romanian vocals" },
  filipino: { lyric: "Filipino/Tagalog: real Tagalog (mahal kita, ikaw, puso, ako). Taglish only if English was also picked.", voice: "Filipino Tagalog vocals" },
  tagalog: { lyric: "Tagalog: real Tagalog (mahal kita, ikaw, puso, ako).", voice: "Tagalog vocals" },
};

function key(lang: string) {
  return lang.trim().toLowerCase();
}

/** Extra lyric-writing notes for the picked languages (empty when none apply). */
export function languageLyricNotes(langs: string[]): string {
  const notes = langs.map((l) => GUIDE[key(l)]?.lyric).filter(Boolean);
  return notes.length ? ` LANGUAGE ACCURACY: ${notes.join(" ")}` : "";
}

/** Short vocal-pronunciation hint for the music engine. */
export function languageVoiceHint(langs: string[]): string {
  return langs.map((l) => GUIDE[key(l)]?.voice ?? `${l} vocals with native pronunciation`).join(", ");
}
