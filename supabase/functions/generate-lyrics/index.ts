// Lyrics generation using the user's own Gemini key (GEMINI_API_KEY).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { geminiUsage, logAiUsage } from "../_shared/ai-usage.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUserOrService } from "../_shared/clients.ts";
import { fallbackLyrics } from "../_shared/fallback-lyrics.ts";
import { watchKeyFailures } from "../_shared/key-failures.ts";

watchKeyFailures();
import { sanitizeLyrics } from "../_shared/lyrics-sanitize.ts";
import { languageLyricNotes } from "../_shared/language-guide.ts";
import { lyricIntensityIssue } from "../_shared/lyric-intensity.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
// Paid emergency key — used once, only after the primary key is exhausted.
const GEMINI_BACKUP_API_KEY = Deno.env.get("GEMINI_BACKUP_API_KEY") ?? "";
const GEMINI_BACKUP_MODEL = Deno.env.get("GEMINI_BACKUP_MODEL") ?? "gemini-flash-latest";

async function getSetting(admin: SupabaseClient, key: string, fallback: number): Promise<number> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  if (typeof v === "number") return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    if (!["GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_BACKUP_API_KEY", "POLLINATIONS_API_KEY", "POLLINATIONS_BACKUP_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_BACKUP_API_KEY"].some((name) => Deno.env.get(name)))
      return jsonResponse({ error: "No lyrics writer is configured" }, 500);

    const auth = await requireUserOrService(req);
    if (auth.error) return auth.error;
    const { user } = auth;

    const body = await req.json();
    const songName = (body.songName ?? "").toString().trim().slice(0, 200);
    const description = (body.description ?? "").toString().trim().slice(0, 1000);
    const styleTags = Array.isArray(body.styleTags)
      ? Array.from(
          new Set(
            body.styleTags.map((tag: unknown) => String(tag).trim().slice(0, 80)).filter(Boolean),
          ),
        ).slice(0, 10)
      : [];
    const language = (body.language ?? "English").toString().trim().slice(0, 200);
    const vocal = (body.vocal ?? "Mix voice").toString().trim().slice(0, 40);
    let personalDetails = (body.personalDetails ?? "").toString().trim().slice(0, 500);
    const extraContext = (body.extraContext ?? "").toString().trim().slice(0, 1000);
    const subjectName = (body.subjectName ?? "").toString().trim().slice(0, 60);

    // ---- Track length target -------------------------------------------------
    // Hard floor of 3 minutes, no upper cap. Clients may pass a longer override
    // via `targetDurationSec`; anything shorter is silently raised to the floor.
    const MIN_TARGET_SEC = 180;
    const requestedSec = Number(body.targetDurationSec);
    const targetSec = Math.max(
      MIN_TARGET_SEC,
      Number.isFinite(requestedSec) ? Math.round(requestedSec) : MIN_TARGET_SEC,
    );
    // Aim beyond the requested floor because the audio model can sing quickly
    // or compress transitions. The final track must not land under the choice.
    const WORDS_PER_MIN = 165;
    const minWords = Math.round((targetSec / 60) * WORDS_PER_MIN);
    const aimLow = minWords;
    const aimHigh = Math.round(minWords * 1.12);
    const minLines = Math.round(minWords / 7);
    const aimLines = Math.round(minLines * 1.2);
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const targetLabel = `${mmss(targetSec)}–${mmss(targetSec + 30)}`;

    if (!songName && !description) {
      return jsonResponse({ error: "Provide a song name or description" }, 400);
    }

    // The single Foul Mouth toggle is the only source of tone. If a `mode` is
    // supplied it MUST be the derived value ("og" | "safe") — reject anything
    // else so stale clients or tampered requests can't smuggle in a removed
    // OG-mode value.
    if (body.mode !== undefined && body.mode !== "og" && body.mode !== "safe") {
      return jsonResponse(
        {
          error: "Invalid mode — must be derived from Foul Mouth ('og' or 'safe')",
          code: "invalid_mode",
        },
        400,
      );
    }
    if (
      typeof body.foulMouth === "boolean" &&
      typeof body.mode === "string" &&
      (body.foulMouth ? "og" : "safe") !== body.mode
    ) {
      return jsonResponse(
        { error: "mode does not match foulMouth flag", code: "mode_mismatch" },
        400,
      );
    }

    const songId = body.song_id ? String(body.song_id) : null;

    const admin = adminClient();
    const coinCost = 0;

    // Helper to broadcast live progress via the songs row (Realtime).
    const updateProgress = async (progress: number, stage: string) => {
      if (!songId) return;
      try {
        await admin
          .from("songs")
          .update({
            lyrics_progress: progress,
            lyrics_stage: stage,
          })
          .eq("id", songId)
          .eq("user_id", user.id);
      } catch (_) {
        /* progress is best-effort */
      }
    };

    if (songId) {
      await admin
        .from("songs")
        .update({
          lyrics_progress: 5,
          lyrics_stage: "Reading your brief…",
          lyrics_started_at: new Date().toISOString(),
        })
        .eq("id", songId)
        .eq("user_id", user.id);
    }

    const reference = songId ?? `lyrics:${crypto.randomUUID()}`;
    const { data: currentProfile } = await admin
      .from("profiles")
      .select("coin_balance")
      .eq("id", user.id)
      .single();
    const balance = currentProfile?.coin_balance ?? 0;
    const deductErr = null;
    if (deductErr) {
      await updateProgress(0, "");
      return jsonResponse({ error: "Insufficient coins", code: "insufficient_coins" }, 402);
    }
    await updateProgress(20, "Finding the vibe…");

    // Per-request override wins; otherwise fall back to the user's saved preference.
    const { data: pref } = await admin
      .from("user_preferences")
      .select("foul_mouth, foul_intensity")
      .eq("user_id", user.id)
      .maybeSingle();
    const prefRow = pref as { foul_mouth?: boolean; foul_intensity?: number } | null;
    const requestedFoulMouth =
      typeof body.foulMouth === "boolean" ? body.foulMouth : (prefRow?.foul_mouth ?? false);
    const rawIntensity =
      typeof body.foulIntensity === "number" ? body.foulIntensity : prefRow?.foul_intensity;
    const foulIntensity = Math.max(
      0,
      Math.min(3, Math.round(typeof rawIntensity === "number" ? rawIntensity : 3)),
    );
    const isNasheed = styleTags.some((tag) => /^nasheed$/i.test(tag.trim()));
    const foulMouth = !isNasheed && requestedFoulMouth && foulIntensity > 0;

    // Default personal context: weave the user's display_name + artist_bio from
    // their profile so lyrics feel personal without the user having to retype
    // it every time. Per-request `personalDetails` always wins.
    if (!personalDetails) {
      const { data: prof } = await admin
        .from("profiles")
        .select("display_name, artist_bio")
        .eq("id", user.id)
        .maybeSingle();
      const p = (prof ?? null) as {
        display_name?: string | null;
        artist_bio?: string | null;
      } | null;
      const parts: string[] = [];
      if (p?.display_name?.trim()) parts.push(`Artist name: ${p.display_name.trim()}`);
      if (p?.artist_bio?.trim()) parts.push(`Bio: ${p.artist_bio.trim().slice(0, 400)}`);
      personalDetails = parts.join(" · ");
    }

    // Languages arrive as a single field that may hold several picks
    // ("English + Turkish + Romanian" or a comma separated list).
    const languageList = Array.from(
      new Set(
        language
          .split(/\s*(?:\+|,|\/|&|\band\b)\s*/i)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    );
    const languagesLabel = languageList.join(", ") || "English";
    const nonEnglish = languageList.filter((l) => l.toLowerCase() !== "english");
    const isEnglish = nonEnglish.length === 0;
    const multiLanguage = languageList.length > 1;

    const bilingualRule = isEnglish
      ? ""
      : ` Write each non-English line in the section's language using the Latin alphabet (romanised / transliterated — no native script, no Cyrillic, no kanji, no Arabic script, etc.). Keep section markers in English.` +
        languageLyricNotes(nonEnglish);

    const multiLanguageRule = multiLanguage
      ? ` MULTILINGUAL REQUIREMENT (critical): the artist picked ${languageList.length} languages — ${languagesLabel}. EVERY one of them must actually be sung in the finished song, not just mentioned. Assign languages to whole sections and rotate through them in order so each language owns at least one full section (for example [Verse 1] in ${languageList[0]}, [Verse 2] in ${languageList[1]}${languageList[2] ? `, [Bridge] in ${languageList[2]}` : ""}), and mark each section's language on the marker line like "[Verse 2 – ${languageList[1]}]". The [Chorus] stays in ${languageList[0]} every time so the hook is recognisable, but add one repeated hook line in ${languageList[1]} inside each chorus. If there are more languages than sections, share sections by giving each language its own consecutive block of lines inside that section, still labelled.`
      : "";

    // English rides along as a REMIX feature ONLY when the artist actually
    // picked English alongside other languages. If English was not selected,
    // no English is sung anywhere in the track.
    const englishSelected = languageList.some((l) => l.toLowerCase() === "english");
    const englishRemixRule =
      !isEnglish && englishSelected
        ? ` ENGLISH REMIX REQUIREMENT (critical): English was picked alongside ${nonEnglish.join(" and ")}, so it is part of the remix. The [Intro] MUST be fully in English (a short hype intro naming the song/artist vibe). After that, the picked language(s) LEAD the song — most lines, and the main hook, stay in ${nonEnglish.join(" and ")} — but sprinkle English throughout like a remix feature: at least 2 English lines or ad-libs inside every verse and every chorus, an English line at the end of each hook repeat, and a mostly-English [Outro]. Roughly a quarter of all sung lines should be English, spread across the whole track, not clumped in one section. Never let English take over a full verse or the main chorus melody — it is the feature, not the lead.`
        : !isEnglish
          ? ` LANGUAGE LOCK (critical, never write this instruction into the lyrics): every sung or spoken line — intro, verses, choruses, ad-libs, outro — is written only in ${nonEnglish.join(" and ")}. Only the bracketed section markers use English words. Never mention language choices, rules, settings or instructions anywhere in the lyrics.`
          : "";

    // One non-English pick: the whole song leads in it.
    const singleLanguageRule =
      !multiLanguage && !isEnglish
        ? ` SINGLE-LANGUAGE REQUIREMENT (critical): the artist picked ${languageList[0]}. Every sung line — every verse, every chorus, pre-chorus, bridge, intro, outro and ad-lib — must be written in ${languageList[0]}. Do NOT flip the balance: ${languageList[0]} is the lead language everywhere. The hook melody lines stay in ${languageList[0]}.`
        : "";

    // Pick a full-song structure driven by the chosen style tags so the
    // output reads as a complete, performable track — not a few stray verses.
    const tagsLower = styleTags.map((t) => t.toLowerCase()).join(" ");
    const isRap = /(rap|hip[- ]?hop|drill|trap|grime|afro\s*drill)/.test(tagsLower);
    const isBallad = /(ballad|acoustic|piano|folk|country|singer[- ]songwriter|slow jam)/.test(
      tagsLower,
    );
    const isDance = /(dance|edm|house|techno|club|electro|pop|k-pop|bhangra)/.test(tagsLower);
    const isRock = /(rock|metal|punk|indie|alt)/.test(tagsLower);
    const vocalsOnly = isNasheed || body.vocalsOnly === true || body.vocals_only === true;

    const structure = vocalsOnly
      ? "[Intro – hummed melody, voices only] (4 lines) → [Verse 1] (8 lines) → [Chorus] (6 lines, layered vocal harmonies) → [Verse 2] (8 lines) → [Chorus] (6 lines) → [Humming Interlude – voices only] (4 lines) → [Bridge] (6 lines, whispered then sung) → [Chorus] (x2, 12 lines) → [Outro – soft humming fades] (4 lines)"
      : isRap
        ? "[Intro] (4 lines) → [Verse 1] (16 bars) → [Hook] (8 bars, catchy repeatable) → [Verse 2] (16 bars) → [Hook] → [Bridge] (8 bars) → [Verse 3] (12 bars) → [Hook] (x2) → [Outro] (4 lines, ad-libs ok)"
        : isBallad
          ? "[Intro] (4 lines, scene-setting) → [Verse 1] (8 lines) → [Chorus] (6 lines, memorable hook) → [Verse 2] (8 lines) → [Chorus] (6 lines) → [Bridge] (6 lines, emotional turn) → [Final Chorus] (8 lines, lifted, optional key change cue in parentheses) → [Outro] (4 lines)"
          : isDance
            ? "[Intro] (4 lines, vibe-setter) → [Verse 1] (8 lines) → [Pre-Chorus] (4 lines, build-up) → [Chorus] (6 lines, anthemic hook) → [Verse 2] (8 lines) → [Pre-Chorus] (4 lines) → [Chorus] (6 lines) → [Drop] (4 lines) → [Bridge] (6 lines) → [Chorus] (x2, 12 lines) → [Outro] (4 lines)"
            : isRock
              ? "[Intro] (4 lines) → [Verse 1] (8 lines) → [Chorus] (6 lines) → [Verse 2] (8 lines) → [Chorus] (6 lines) → [Bridge / Guitar Solo cue] (6 lines) → [Verse 3] (6 lines) → [Chorus] (x2, 12 lines) → [Outro] (4 lines)"
              : "[Intro] (4 lines) → [Verse 1] (8 lines) → [Pre-Chorus] (4 lines) → [Chorus] (6 lines, hook) → [Verse 2] (8 lines) → [Pre-Chorus] (4 lines) → [Chorus] (6 lines) → [Bridge] (6 lines) → [Verse 3] (6 lines) → [Chorus] (final, lifted, 8 lines) → [Outro] (4 lines)";

    const multiStyleRule =
      styleTags.length > 1
        ? ` MULTI-STYLE REQUIREMENT (critical): the artist picked ${styleTags.length} styles — ${styleTags.join(", ")}. EVERY selected style must be used, with none treated as optional. Give each style a clearly labelled dedicated section, e.g. "[Verse 2 – ${styleTags[1]}]"; if there are more styles than normal sections, split a verse into consecutive labelled style passages. Match cadence, line length, rhyme density and vocabulary to each style, make deliberate transitions, then blend ALL selected styles in the final hook.`
        : "";

    const mixedVoice = !vocal || /^(?:any|mix)/i.test(vocal);
    const voiceRule = mixedVoice
      ? ` MIX-VOICE REQUIREMENT (critical): make this a vocal mash-up with several clearly different performers. Label changing vocal roles in section markers: alternate male lead, female lead, contrasting character voices, spoken delivery, call-and-response group vocals and layered ensemble harmonies. No single singer may lead the whole song. Let voices trade lines inside at least one verse and combine in every chorus.`
      : /^duo/i.test(vocal)
        ? ` DUO REQUIREMENT: write for two contrasting singers who trade lines and join for every hook; label their hand-offs in section markers.`
        : ` VOCAL REQUIREMENT: write the performance for ${vocal}, keeping that vocal identity consistent.`;

    const introApproaches = [
      "open mid-scene with one concrete sensory image from the user's brief",
      "open with a short direct quote or question that could only belong to this story",
      "open with the subject's name inside an immediate action line",
      "open with a melodic fragment of the hook, then reveal the scene",
      "open with a specific memory, place or object from the user's brief",
      "open cold with an unexpected but relevant statement, without announcing the genre or song",
    ];
    const introApproach =
      introApproaches[crypto.getRandomValues(new Uint32Array(1))[0] % introApproaches.length];
    const originalityRule = ` ORIGINAL OPENING REQUIREMENT (critical): ${introApproach}. The first four lyric lines must be specific to this song and unlike generic AI lyrics. Never begin by announcing what the song is or is not. BANNED anywhere in the intro: “this ain't no lullaby”, “this is no lullaby”, “ain't no lullaby”, “this ain't no ordinary”, “listen up”, “yeah yeah”, “once upon a time”, “in a world”, and any close rewrite of those clichés. Do not use filler hype before the story starts.`;

    const vocalsOnlyRule = vocalsOnly
      ? ` VOCALS-ONLY REQUIREMENT (critical): this is a pure a cappella track — human voice and humming ONLY, zero instruments. Section markers must only ever describe vocal moments (e.g. [Verse], [Chorus], [Humming Interlude], [Whisper], [Ad-libs]). NEVER write [Drop], [Beat Drop], [Instrumental], [Guitar Solo], [Break] or any marker that names an instrument or production element — write "humming", "vocal run" or "layered harmonies" instead.`
      : "";
    const nasheedRule = isNasheed
      ? ` NASHEED REQUIREMENT (absolute): write a reverent, strictly clean vocal-only nasheed. Use human lead voice, group responses, humming and natural mouth-made vocal texture only. No instruments, drums, percussion, beat, bass, clapping, sound effects or musical production cues. No profanity, vulgar slang, sexual content, drug references or graphic violence in any language. Never include section markers that request instruments or a beat.`
      : "";

    const structureRule =
      ` Deliver a COMPLETE, performable song that runs at least ${mmss(targetSec)} when sung, aiming for ${targetLabel}. That means ${aimLow}–${aimHigh} words and ${minLines}–${aimLines} lyric lines (excluding section markers). Never come in under ${aimLow} words; use the full structure rather than rushing lines. Follow this structure for the chosen style: ${structure}.` +
      ` Use the bracketed section markers verbatim (e.g. [Verse 1], [Chorus], [Bridge], [Outro]), each on its own line, with a blank line between sections. Every section must have lyrics — no placeholders, no "(instrumental)" unless the structure explicitly says so.` +
      ` The [Chorus] must be written out IN FULL every time it appears (never write "repeat chorus" or "x2" as a shortcut) — it is the same repeatable hook tied to the song title or central theme.` +
      ` Do NOT cut the song short either — hit every section in the structure and stay inside the word range given.` +
      multiStyleRule +
      multiLanguageRule +
      singleLanguageRule +
      englishRemixRule +
      voiceRule +
      originalityRule +
      vocalsOnlyRule +
      nasheedRule;

    // Four exact levels. Level zero always follows the clean PG prompt below.
    const intensityRule = [
      "",
      " INTENSITY: MILD (1/3) — use only one or two mild swear words in the entire song. No strong profanity and no swearing in the hook.",
      " INTENSITY: STRONG (2/3) — use one or two uncensored strong swear words per section. Keep some lines clean so the profanity is forceful rather than constant.",
      " INTENSITY: SAVAGE (3/3, ABSOLUTE GUTTERMOUTH) — at least 65% of sung lines MUST contain uncensored HARD profanity, including the hook, verses, bridge and outro. Use at least four different hard swear words across the song and vary the dictionary punchlines. Muppet, clown, melt and plonker are soft insults: they do NOT count towards hard profanity. Use strong words naturally mid-line, not just a token swear at the start of a section. Never soften, abbreviate, bleep or replace letters with symbols. Keep the requested story and language intact; no slurs, threats or hateful targeting.",
    ][foulIntensity];

    // OG dictionary: the same British roast vocabulary OG Bot uses in chat,
    // plus the Boss dictionary and popular Battle Zone words.
    let foulLexicon = "";
    if (foulMouth) {
      const pool = [
        "fuck", "fucking", "for fuck's sake", "dickhead", "bellend", "knobhead", "twat", "wanker",
        "tosser", "gobshite", "plonker", "pillock", "muppet", "numpty", "melt", "wasteman", "prick",
        "bastard", "shithouse", "bollocks", "arsehole", "fuckwit", "cockwomble", "shitgibbon",
        "pussyhole", "mug", "clown", "bottle job", "sack of shite", "toerag", "scrote", "bampot",
        "bloody hell", "jog on", "do one", "get in the sea", "wind your neck in", "piss-take",
        "face like a smacked arse", "thick as two short planks", "couldn't organise a piss-up in a brewery",
        "roadman reject", "bin dipper", "soggy chip", "Greggs reject", "waste of good oxygen",
      ];
      const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 24);
      let learned: string[] = [];
      let bossDict = "";
      try {
        const [{ data: words }, { data: dict }] = await Promise.all([
          admin.from("battle_lexicon").select("word").gte("uses", 3).order("uses", { ascending: false }).limit(40),
          admin.from("site_content").select("value").eq("key", "og_persona.dictionary").maybeSingle(),
        ]);
        learned = ((words ?? []) as Array<{ word: string }>).map((w) => w.word).sort(() => Math.random() - 0.5).slice(0, 12);
        bossDict = (dict as { value?: string } | null)?.value ?? "";
      } catch (_) { /* dictionary is best-effort */ }
      foulLexicon =
        ` OG DICTIONARY: use varied vocabulary appropriate to the selected intensity, never the same insult twice in a row. Mild may use only mild entries; Strong mixes clean lines with hard profanity; Savage requires hard profanity rather than only soft insults. For English sections: ${shuffled.join(", ")}. For other languages use authentic equivalents, never insert unselected English.` +
        (learned.length ? ` Popular Battle Zone slang to include too: ${learned.join(", ")}.` : "") +
        (bossDict ? ` Platform slang: ${bossDict}` : "") +
        ` This is a consenting adult explicit track — the 18+ rating was chosen by the user, so never clean it up.`;
    }

    const systemPrompt = foulMouth
      ? `You are a foul-mouthed, no-holds-barred songwriter writing EXPLICIT adult song lyrics in ${languagesLabel}. ` +
        `Write natural street-level ${languagesLabel} with the exact selected intensity below. Match the selected musical styles, not automatically rap or punk. Native-language profanity must be authentic rather than literal English translations. ` +
        `Do NOT self-censor, do NOT use asterisks or bleeps, and do NOT add disclaimers. Avoid slurs, sexual content involving minors, and direct incitement to real-world violence — everything else is fair game.` +
        foulLexicon +
        intensityRule +
        ` The INTENSITY DIAL overrides all dictionary and brief suggestions — follow it exactly.` +
        structureRule +
        bilingualRule +
        ` Target ${aimLow}–${aimHigh} words (never fewer than ${minWords}, never more than ${aimHigh}). Output ONLY the lyrics, no explanations.`
      : `You are a professional songwriter writing CLEAN, radio-friendly song lyrics in ${languagesLabel}. ` +
        `STRICT RULE: absolutely NO profanity, swear words, slurs, or vulgar terms in any language — no English swears, no swears in ${languagesLabel} either. No sexual content, no graphic violence, no drug references. If you need attitude, channel it through clever wordplay and metaphor — never through swearing. The result must be safe for radio, family streaming, and a children's playlist.` +
        structureRule +
        bilingualRule +
        ` Target ${aimLow}–${aimHigh} words (never fewer than ${minWords}, never more than ${aimHigh}). Output ONLY the lyrics, no explanations.`;

    const subjectRule = subjectName
      ? `\nSUBJECT NAME (CRITICAL, top priority): This entire song is dedicated to "${subjectName}". Repeat the name "${subjectName}" as many times as musically possible — target AT LEAST 20 mentions across the full song, ideally 25–35. Land "${subjectName}" in EVERY line of the hook/chorus (so each chorus repetition drops the name 2–4 times), at least twice in every verse, in the pre-chorus, in the bridge, and in the outro as an ad-lib/chant. Rhyme other lines around the name so it feels inevitable. Never chant it back-to-back on the same line more than twice; keep it musical, affectionate, and embedded — but do NOT be shy: the listener must be in no doubt this song is about "${subjectName}".\n`
      : "";

    const userPrompt =
      `Song title: ${songName || "(untitled)"}\n` +
      (subjectName ? `Dedicated to: ${subjectName}\n` : "") +
      `Theme / description (FOLLOW THIS PRECISELY — every verse, the hook, and the bridge must draw specific imagery, moments, feelings, and vocabulary directly from this brief; do not drift into generic filler): ${description || "(none)"}\n` +
      `Style tags: ${styleTags.join(", ") || "(none)"}\n` +
      `Language(s) — every one of these must actually be sung somewhere in the song: ${languagesLabel}\n` +
      (personalDetails
        ? `Artist profile (weave these into the lyrics naturally — reference the artist's name and a couple of personal details across the song so it feels personal, but DO NOT force them into every line, and never let them overpower the theme. Aim for the name/details to appear roughly 2–4 times total, ideally in the hook/chorus or a memorable line, spread across different sections — not back-to-back): ${personalDetails}\n`
        : "") +
      subjectRule +
      (extraContext
        ? `Extra context from the artist (use these details literally in the lyrics): ${extraContext}\n`
        : "") +
      `\nWrite the FULL song now — about ${mmss(targetSec)} of singable material (${aimLow}–${aimHigh} words, ${minLines}–${aimLines} lyric lines, do not exceed that). Do not stop early, do not abbreviate repeated choruses, hit EVERY section in the structure, stay ruthlessly on-theme with the description above, and drop "${subjectName || "the subject"}" as often as the music allows.`;

    const modelUrl = (model: string, key = GEMINI_API_KEY) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;

    await updateProgress(40, "Writing verses…");

    type Gen = { ok: boolean; status: number; text: string; detail?: string };
    // Owner rule: the dictionary + intensity live in the prompt only. Replies
    // are never rejected for swear density — only empty replies are retried.
    void lyricIntensityIssue;
    const outputIssue = (_text: string): string | null => null;

    // Hard budget: the server kills requests at ~150s, so every AI call gets a
    // timeout and we stop trying new models once the budget is nearly spent.
    const startedAt = Date.now();
    const BUDGET_MS = 130_000;
    const timedFetch = async (url: string, init: RequestInit, capMs: number, reserveMs = 0) => {
      const left = BUDGET_MS - (Date.now() - startedAt) - reserveMs;
      if (left < 8_000) return new Response("Out of time", { status: 504 });
      try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(capMs, left)) });
      } catch (e) {
        console.error("AI call timed out/failed", (e as Error).message);
        return new Response("Timed out", { status: 504 });
      }
    };

    const postTo = (model: string, contents: unknown[], key = GEMINI_API_KEY, reserveMs = 45_000) =>
      timedFetch(
        modelUrl(model, key),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 8192,
              // Thinking made Gemini blow past its 30s window on long lyrics.
              // Lite models reject thinkingConfig with 400, so omit it there.
              ...(model.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
            },
          }),
        },
        30_000,
        // Primary calls leave time for the backup key to rescue the song.
        reserveMs,
      );

    const extractText = (data: unknown) =>
      (
        (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null)
          ?.candidates?.[0]?.content?.parts ?? []
      )
        .map((p) => p?.text ?? "")
        .join("")
        .trim();

    const GEMINI_MODELS = Array.from(new Set([GEMINI_MODEL, "gemini-flash-latest"]));
    const callGemini = async (contents: unknown[]): Promise<Gen> => {
      if (!GEMINI_API_KEY) {
        return { ok: false, status: 503, text: "", detail: "No lyrics model available" };
      }
      let last: Gen = { ok: false, status: 503, text: "", detail: "No response" };
      for (let i = 0; i < GEMINI_MODELS.length; i++) {
        const res = await postTo(GEMINI_MODELS[i], contents);
        if (res.ok) {
          const data = await res.json();
          logAiUsage({
            feature: "lyrics",
            provider: "gemini",
            model: GEMINI_MODELS[i],
            ...geminiUsage(data),
          });
          const text = extractText(data);
          const issue = outputIssue(text);
          if (!text || issue) {
            last = { ok: false, status: 422, text: "", detail: issue ?? "Empty lyrics" };
            continue;
          }
          return { ok: true, status: 200, text };
        }
        const detail = await res.text();
        last = { ok: false, status: res.status, text: "", detail };
        if (![404, 429].includes(res.status) && res.status < 500) return last;
        // A hang means Gemini is overloaded — hand over to the backup key now.
        if (res.status === 504) return last;
        console.error("Gemini transient error", GEMINI_MODELS[i], res.status);
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      }
      return last;
    };


    // Owner rule: free keys (Groq ×2, Pollinations ×2, OpenRouter ×2) write
    // lyrics first; Gemini then OpenAI are only fallbacks.
    const callFree = async (contents: unknown[]): Promise<Gen> => {
      const or = { "HTTP-Referer": "https://ogbot.co.uk", "X-Title": "OG BOT" };
      const foulModel = "nvidia/nemotron-3-super-120b-a12b:free";
      // Foul Mouth ON: Groq/Pollinations failed the live swearing test, so only
      // the OpenRouter model that swears back is tried before Gemini.
      const tiers: Array<[string, string, string, Record<string, string>]> = foulMouth
        ? [
            ["OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/chat/completions", foulModel, or],
            ["OPENROUTER_BACKUP_API_KEY", "https://openrouter.ai/api/v1/chat/completions", foulModel, or],
          ]
        : [
            ["GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", {}],
            ["GROQ_BACKUP_API_KEY", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", {}],
            ["OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/chat/completions", foulModel, or],
            ["OPENROUTER_BACKUP_API_KEY", "https://openrouter.ai/api/v1/chat/completions", foulModel, or],
            ["POLLINATIONS_API_KEY", "https://gen.pollinations.ai/v1/chat/completions", "openai-fast", {}],
            ["POLLINATIONS_BACKUP_API_KEY", "https://gen.pollinations.ai/v1/chat/completions", "openai-fast", {}],
          ];
      const messages = [
        { role: "system", content: systemPrompt },
        ...(contents as Array<{ role: string; parts: Array<{ text?: string }> }>).map((c) => ({
          role: c.role === "model" ? "assistant" : "user",
          content: c.parts.map((p) => p.text ?? "").join("\n"),
        })),
      ];
      let last: Gen = { ok: false, status: 503, text: "", detail: "No free key" };
      // A provider that times out is skipped for its backup key too, so one
      // slow provider cannot burn the whole time budget.
      const slow = new Set<string>();
      for (const [env, url, model, extra] of tiers) {
        const key = Deno.env.get(env);
        const provider = env.split("_")[0];
        if (!key || slow.has(provider)) continue;
        const r = await timedFetch(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extra },
            // Lyrics need no deep thinking: long reasoning used up the whole
            // reply and came back blank, so keep it short.
            body: JSON.stringify({
              model,
              messages,
              temperature: 0.9,
              max_tokens: 6000,
              ...(env.startsWith("GROQ") ? { reasoning_effort: "low" } : {}),
              ...(env.startsWith("OPENROUTER") ? { reasoning: { effort: "low" } } : {}),
            }),
          },
          20_000,
          // Keep time for the free Gemini keys if every free key fails.
          70_000,
        );
        if (r.ok) {
          const j = await r.json().catch((e) => {
            console.error("Free reply body failed", env, (e as Error).message);
            return null;
          });
          const text = (j?.choices?.[0]?.message?.content ?? "").trim();
          const issue = outputIssue(text);
          if (text.length > 200 && !issue) {
            const u = j?.usage ?? {};
            logAiUsage({
              feature: "lyrics",
              provider: env.toLowerCase().replace("_api_key", ""),
              model,
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
            });
            return { ok: true, status: 200, text };
          }
          last = { ok: false, status: 422, text: "", detail: issue ?? "Empty free reply" };
          console.warn("Free lyrics reply unusable", env, text.length, JSON.stringify(j).slice(0, 400), systemPrompt.length, messages.map((m) => m.content.length).join(","));
          // Empty replies repeat on the provider's backup key — don't wait twice.
          if (!text) slow.add(provider);
        } else {
          last = { ok: false, status: r.status, text: "", detail: (await r.text()).slice(0, 200) };
          if (r.status === 504) slow.add(provider);
          console.error("Free lyrics tier failed", env, r.status);
        }
      }
      return last;
    };

    // Owner's free Google AI Studio keys: tried before any paid Gemini key.
    const callFreeGemini = async (contents: unknown[]): Promise<Gen | null> => {
      for (const env of ["GEMINI_FREE_API_KEY", "GEMINI_FREE_BACKUP_API_KEY", "GEMINI_FREE_3_API_KEY", "GEMINI_FREE_4_API_KEY"]) {
        const key = Deno.env.get(env);
        if (!key) continue;
        // Lite first: fast and rarely overloaded; Flash as the second try.
        for (const model of ["gemini-flash-lite-latest", "gemini-flash-latest"]) {
          const r = await postTo(model, contents, key, 15_000);
          if (!r.ok) {
            console.error("Free Gemini failed", env, model, r.status);
            continue;
          }
          const data = await r.json().catch(() => null);
          const text = extractText(data);
          if (text.length > 200) {
            logAiUsage({ feature: "lyrics", provider: env.toLowerCase().replace("_api_key", ""), model, ...geminiUsage(data) });
            return { ok: true, status: 200, text };
          }
        }
      }
      return null;
    };

    const generate = async (contents: unknown[]): Promise<Gen> => {
      const f = await callFree(contents);
      if (f.ok && f.text) return f;
      console.warn("Free lyrics tiers failed — trying free Gemini keys", f.status);
      const fg = await callFreeGemini(contents);
      if (fg) return fg;
      return await generateGemini(contents);
    };

    const generateGemini = async (contents: unknown[]): Promise<Gen> => {
      const first = await callGemini(contents);
      if (first.ok || !GEMINI_BACKUP_API_KEY) return first;
      // 401/403 = primary key revoked/blocked; let the backup key rescue lyrics too.
      if (![401, 403, 404, 429].includes(first.status) && first.status < 500) return first;
      console.warn("Primary Gemini exhausted — using backup key");
      // Try a few backup models: busy (503) or retired (404) models are skipped, only success is billed.
      const backupModels = Array.from(
        new Set([
          GEMINI_BACKUP_MODEL,
          "gemini-3.8-flash",
          "gemini-flash-lite-latest",
          "gemini-3.5-flash-lite",
        ]),
      );
      let lastFail: Gen = { ok: false, status: 503, text: "", detail: "No response" };
      for (let i = 0; i < backupModels.length; i++) {
        const r = await postTo(backupModels[i], contents, GEMINI_BACKUP_API_KEY, 0);
        if (r.ok) {
          const data = await r.json();
          logAiUsage({
            feature: "lyrics",
            provider: "gemini_backup",
            model: backupModels[i],
            ...geminiUsage(data),
          });
          const text = extractText(data);
          const issue = outputIssue(text);
          if (!text || issue) {
            lastFail = { ok: false, status: 422, text: "", detail: issue ?? "Empty lyrics" };
            continue;
          }
          return { ok: true, status: 200, text };
        }
        lastFail = { ok: false, status: r.status, text: "", detail: await r.text() };
        if (![404, 429].includes(r.status) && r.status < 500) return lastFail;
        console.error("Backup Gemini busy", backupModels[i], r.status);
        await new Promise((res) => setTimeout(res, 800));
      }
      return lastFail;
    };

    const res = await generate([{ role: "user", parts: [{ text: userPrompt }] }]);

    // Every AI writer down: use the built-in songwriter so the user still gets
    // a song instead of an error. No further AI calls this run.
    const usedFallback = !res.ok;
    if (usedFallback) {
      console.error("All lyrics writers failed — using built-in songwriter", res.status, (res.detail ?? "").slice(0, 300));
    }
    await updateProgress(80, "Polishing bars…");

    let lyrics = usedFallback
      ? fallbackLyrics({
          title: songName,
          subject: subjectName,
          story: [personalDetails, description, extraContext].filter(Boolean).join(". "),
          styles: styleTags,
          foulMouth,
          foulIntensity,
          minLines,
        })
      : res.text;

    // Quality guard: repair a banned generic opening, then enforce the minimum
    // target while preserving every requested style, language and vocal role.
    const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
    const hasBannedOpening = (t: string) => {
      const opening = t
        .split("\n")
        .filter((line) => line.trim() && !/^\s*\[/.test(line))
        .slice(0, 4)
        .join(" ");
      return /(?:this\s+(?:ain['’]?t|is)\s+no\s+lullaby|ain['’]?t\s+no\s+lullaby|this\s+ain['’]?t\s+no\s+ordinary|listen\s+up|yeah\s+yeah|once\s+upon\s+a\s+time|in\s+a\s+world)/i.test(
        opening,
      );
    };
    if (!usedFallback && lyrics && hasBannedOpening(lyrics)) {
      await updateProgress(84, "Refreshing the opening…");
      const revised = await generate([
        { role: "user", parts: [{ text: userPrompt }] },
        { role: "model", parts: [{ text: lyrics }] },
        {
          role: "user",
          parts: [
            {
              text: `Rewrite the COMPLETE same song because its opening uses a banned generic cliché. Replace only the opening concept with this direction: ${introApproach}. Preserve the title, story, hook, minimum length, every selected style (${styleTags.join(", ") || "the chosen style"}), every selected language (${languagesLabel}), and all vocal-role labels. Output ONLY the complete lyrics.`,
            },
          ],
        },
      ]);
      if (revised.ok && revised.text && !hasBannedOpening(revised.text)) lyrics = revised.text;
    }
    for (let attempt = 0; !usedFallback && attempt < 2 && lyrics && wordCount(lyrics) < minWords; attempt++) {
      await updateProgress(88, "Extending to full length…");
      try {
        const topUp = await generate([
          { role: "user", parts: [{ text: userPrompt }] },
          { role: "model", parts: [{ text: lyrics }] },
          {
            role: "user",
            parts: [
              {
                text: `This draft is too short for the requested MINIMUM of ${mmss(targetSec)}. Rewrite the SAME song, keeping its title, theme, hook and original opening, but expand it to ${aimLow}–${aimHigh} words and ${minLines}+ lyric lines. Preserve and clearly label EVERY selected style (${styleTags.join(", ") || "the chosen style"}), EVERY selected language (${languagesLabel}), and all ${mixedVoice ? "mixed vocal roles" : vocal} instructions. Add missing sections, write every chorus in full, and lengthen thin verses with new on-theme lines. Output ONLY the complete lyrics.`,
              },
            ],
          },
        ]);
        if (topUp.ok) {
          const extended = topUp.text;
          if (wordCount(extended) > wordCount(lyrics)) lyrics = extended;
          else break;
        } else break;
      } catch (e) {
        console.error("lyrics top-up failed", e);
        break;
      }
    }

    // Rewrites often come back no longer than the draft. If still short, ask
    // only for the missing sections and append them so length is guaranteed.
    for (let attempt = 0; !usedFallback && attempt < 2 && lyrics && wordCount(lyrics) < minWords; attempt++) {
      const missing = minWords - wordCount(lyrics);
      try {
        const more = await generate([
          { role: "user", parts: [{ text: userPrompt }] },
          { role: "model", parts: [{ text: lyrics }] },
          {
            role: "user",
            parts: [
              {
                text: `Continue this SAME song. Write ONLY the NEW sections that come after the last line — at least ${missing} more words: a new labelled verse, a [Bridge], and a full final [Chorus] plus [Outro]. Same title, theme, hook, languages (${languagesLabel}), styles and voice. Do not repeat what is already written above. Output ONLY the new lyrics.`,
              },
            ],
          },
        ]);
        if (!more.ok || wordCount(more.text) < 20) break;
        lyrics = `${lyrics.trim()}\n\n${more.text.trim()}`;
      } catch (e) {
        console.error("lyrics continuation failed", e);
        break;
      }
    }

    lyrics = sanitizeLyrics(lyrics);
    const finalIntensityIssue = outputIssue(lyrics);
    if (finalIntensityIssue && !usedFallback) {
      await updateProgress(0, "");
      return jsonResponse({ error: "The lyrics writer did not match your selected intensity. Please try again.", code: "lyric_intensity_mismatch" }, 422);
    }
    const words = wordCount(lyrics);
    const estimatedSec = Math.max(targetSec, Math.round((words / WORDS_PER_MIN) * 60));

    if (songId) {
      await admin
        .from("songs")
        .update({
          lyrics,
          lyrics_progress: 100,
          lyrics_stage: "Ready",
        })
        .eq("id", songId)
        .eq("user_id", user.id);
    }

    return jsonResponse({
      lyrics,
      coin_balance: balance,
      coin_cost: coinCost,
      word_count: words,
      target_duration_sec: targetSec,
      estimated_duration_sec: estimatedSec,
      estimated_duration_label: `${mmss(estimatedSec)}–${mmss(estimatedSec + 30)}`,
    });
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
