// Suno generation edge function.
// - Verifies the calling user
// - Creates and renders tracks free; charging happens only at final download
// - Deducts coins atomically (refunds on Suno API failure)
// - Calls the Suno API; one task typically produces 2 clips
// - Inserts a 'pending' songs row; suno-callback fills it in + adds extra rows for sibling clips

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserOrService } from "../_shared/clients.ts";
import { watchKeyFailures } from "../_shared/key-failures.ts";

watchKeyFailures();
import { injectSignature, withSignatureHint } from "../_shared/track-signature.ts";
import { sanitizeLyrics } from "../_shared/lyrics-sanitize.ts";
import { languageVoiceHint } from "../_shared/language-guide.ts";
import {
  isModerationRejection,
  MODERATION_MESSAGE,
} from "../_shared/moderation-safe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUNO_API_KEY = Deno.env.get("SUNO_API_KEY")!;
const SUNO_API_URL = "https://apibox.erweima.ai/api/v1/generate";
// Used when the user uploads their own beat — Suno performs vocals over it.
const SUNO_UPLOAD_COVER_URL = "https://apibox.erweima.ai/api/v1/generate/upload-cover";
const ACAPPELLA_STYLE =
  "pure a cappella, vocals only, unaccompanied human voice with layered vocal harmonies and humming, " +
  "every sound made by the human voice and mouth only, absolutely no instruments, no music, no drums, " +
  "no percussion, no bass, no 808, no synths, no piano, no guitar, no strings, no sound effects, " +
  "dry close-mic vocal with light natural room reverb";
const VOCALS_OVER_BEAT_STYLE =
  "vocals only, a cappella lead vocal riding the supplied beat, no added instruments";
const NO_INSTRUMENT_NEGATIVES =
  "instruments, instrumental, music, backing music, backing track, drums, percussion, bass, 808, " +
  "synth, synthesizer, piano, keys, guitar, strings, brass, orchestra, band, beat, producer tag beat, " +
  "sound effects, ambience, dj, scratching, sampler, drum machine";
const MAX_PROMPT_CHARS = 4_800;
const MAX_STYLE_CHARS = 900;
const MAX_TITLE_CHARS = 80;

const GENRE_STYLE_DETAILS: Record<string, string> = {
  pop: "polished modern chart pop, bright melodic topline, immediate singalong chorus, crisp radio-ready production, strong verse-pre-chorus-chorus lift",
  "k-pop":
    "high-energy polished K-pop, dynamic section changes, glossy synth production, tight dance rhythm, layered group vocals, addictive hook and dramatic bridge",
  "slow jam":
    "silky slow jam, warm R&B chords, unhurried groove, intimate expressive vocals, lush harmonies and a sensual late-night atmosphere",
  bhangra:
    "high-energy Punjabi bhangra, driving dhol rhythm, bright tumbi phrases, celebratory call-and-response vocals and a huge dancefloor chorus",
  "nursery rhyme":
    "simple playful nursery-rhyme melody, clear repetitive words, gentle rhythm, memorable singalong refrain and child-friendly musical phrasing",
  "hip hop":
    "classic-meets-modern hip hop, head-nodding boom-bap and modern drums, punchy kick and snare, soulful sampled textures, confident rhythmic flow and a catchy hook",
  rap: "rap-forward track, lead vocal rapped throughout with tight rhythmic flow, clear diction, internal rhymes and punchlines, minimal melodic singing, hard-hitting drums supporting the bars",
  singing:
    "melodic sung vocal performance throughout, expressive lead singer, strong memorable melody, rich harmonies, no rapping, vocals front and centre",
  trap: "modern trap production, deep 808 bass, crisp rolling hi-hats, punchy kick, spacious dark melody and confident rhythmic vocal delivery",
  "drum & bass":
    "high-energy drum and bass, rapid chopped breakbeats around 174 BPM, deep rolling sub-bass, sharp syncopation, rave momentum and fast precise vocal cadence",
  nasheed:
    "strictly vocal-only nasheed, reverent unaccompanied lead voice, layered group responses and gentle human humming, every sound made only by human voices and mouths, absolutely no music or instruments",
};

function expandGenreStyles(raw: string): string {
  return raw
    .split(/\s*,\s*/)
    .map((name) => GENRE_STYLE_DETAILS[name.toLowerCase()] ?? name)
    .join(", ");
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getSetting(admin: any, key: string, fallback: number): Promise<number> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return typeof v === "number" ? v : fallback;
}

function limitText(value: string | null, max: number): string | null {
  if (!value) return value;
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const auth = await requireUserOrService(req);
    if (auth.error) return auth.error;
    const user = auth.user;

    const body = await req.json();
    const prompt = (body.prompt ?? "").toString().trim();
    // Artist voice picked in the wizard ("Female vocal" | "Male vocal" | "Duo" | "Mix voice").
    const vocal = (body.vocal ?? "").toString().trim().slice(0, 40);
    const vocalLower = vocal.toLowerCase();
    const vocalGender = vocalLower.startsWith("female")
      ? "f"
      : vocalLower.startsWith("male")
        ? "m"
        : null;
    const vocalStyle = vocalLower.startsWith("female")
      ? "female vocals, female lead singer"
      : vocalLower.startsWith("male")
        ? "male vocals, male lead singer"
        : vocalLower.startsWith("duo")
          ? "duet, male and female vocals trading lines"
          : "mixed-voice mash-up with several clearly different singers, alternate male and female lead voices between sections, group vocals and layered harmonies in hooks, contrasting spoken and sung textures, do not use one lead voice for the whole track";
    const rawStyle = (body.style ?? "").toString().trim();
    // Nasheed mode lives on the track row (set when it was created, priced
    // double); the style name still switches on the voice-only prompt too.
    let rowNasheed = false;
    if (body.song_id) {
      const { data: flagRow } = await createClient(SUPABASE_URL, SERVICE_ROLE)
        .from("songs")
        .select("is_nasheed, user_id")
        .eq("id", String(body.song_id))
        .maybeSingle();
      rowNasheed = !!flagRow?.is_nasheed && flagRow.user_id === user.id;
    }
    const isNasheed =
      rowNasheed ||
      rawStyle.split(/\s*,\s*/).some((name: string) => /^nasheed$/i.test(name.trim()));
    const detailedStyle = expandGenreStyles(rawStyle);
    const vocalsOnly = isNasheed || !!body.vocals_only;
    const beatPath = isNasheed ? null : body.beat_path ? String(body.beat_path) : null;
    // Vocals-only: sing over the uploaded beat, or fall back to a pure
    // a cappella with humming and zero instrumentation.
    const acappella = vocalsOnly && !beatPath;
    const vocalsOnlyStyle = vocalsOnly
      ? beatPath
        ? VOCALS_OVER_BEAT_STYLE
        : ACAPPELLA_STYLE
      : null;
    // Requested track length. Suno exposes no hard duration field, so the
    // target is steered through the style prompt (clamped 3-10 minutes).
    const rawTarget = Number(body.target_duration_sec);
    const targetDurationSec = Math.min(
      600,
      Math.max(180, Number.isFinite(rawTarget) ? Math.round(rawTarget) : 180),
    );
    const targetMinutes = Math.round(targetDurationSec / 60);
    const minimumDuration = `${Math.floor(targetDurationSec / 60)}:${String(targetDurationSec % 60).padStart(2, "0")}`;
    const lengthStyleHint =
      `minimum finished duration ${minimumDuration}, aim slightly longer than ${targetMinutes} minutes rather than shorter, ` +
      `full-length complete arrangement, perform every lyric line and every written repeat, preserve all verses, choruses, bridges and the outro, ` +
      `no shortened arrangement, no omitted sections, no early ending and no fade before ${minimumDuration}`;
    // Languages the artist picked. Suno has no language field, so the
    // requirement is steered through the style prompt: every picked language
    // must be sung, and section markers in the lyrics say which is which.
    const languageList = Array.from(
      new Set(
        (body.language ?? "")
          .toString()
          .trim()
          .slice(0, 200)
          .split(/\s*(?:\+|,|\/|&|\band\b)\s*/i)
          .map((l: string) => l.trim())
          .filter(Boolean),
      ),
    );
    const languageStyleHint = languageList.length
      ? languageList.length > 1
        ? `multilingual vocals sung in ${languageList.join(" and ")}, switch language per section exactly as the lyric section markers indicate, ${languageVoiceHint(languageList)}`
        : `vocals sung in ${languageList[0]}, ${languageVoiceHint(languageList)}`
      : null;
    // Multiple styles: make the section-to-section genre changes explicit.
    const styleCount = rawStyle ? rawStyle.split(/\s*,\s*/).filter(Boolean).length : 0;
    const multiStyleHint =
      styleCount > 1
        ? `multi-genre mash-up using EVERY selected style: ${rawStyle}; give every style a clearly audible dedicated section, follow genre names in lyric section markers, blend all selected styles in the final hook, and use deliberate transitions so none are ignored`
        : null;
    // For pure a cappella, genre names must only colour the vocal delivery —
    // naming genres outright makes the engine add backing instrumentation.
    const styleParts = acappella
      ? [
          vocalsOnlyStyle,
          detailedStyle
            ? `${detailedStyle} vocal delivery, cadence and phrasing performed by voice alone`
            : null,
          languageStyleHint,
          vocalStyle,
          lengthStyleHint,
        ]
      : [
          detailedStyle,
          multiStyleHint,
          languageStyleHint,
          vocalStyle,
          vocalsOnlyStyle,
          lengthStyleHint,
        ];
    let style = limitText(styleParts.filter(Boolean).join(", ") || null, MAX_STYLE_CHARS);
    const lyrics = limitText((body.lyrics ?? "").toString().trim() || null, MAX_PROMPT_CHARS);
    const title = limitText((body.title ?? "").toString().trim() || null, MAX_TITLE_CHARS);
    const instrumental = !!body.instrumental;
    const portalId = body.portal_id ? String(body.portal_id) : null;
    const existingSongId = body.song_id ? String(body.song_id) : null;

    if (!prompt && !lyrics) return json({ error: "Provide a prompt or lyrics" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Capacity gate: global + per-user concurrent caps (peak mode aware).
    {
      const { data: cap, error: capErr } = await admin.rpc("check_generation_capacity", {
        p_user: user.id,
      });
      if (capErr) return json({ error: capErr.message }, 500);
      if (cap && cap.ok === false) {
        const msg =
          cap.reason === "global_capacity_full"
            ? `Studio is at capacity (${cap.global_active}/${cap.global_cap} jobs running). Try again in a moment.`
            : `You already have ${cap.user_active} song${cap.user_active === 1 ? "" : "s"} generating (limit ${cap.user_cap}${cap.peak ? ", peak mode" : ""}). Wait for one to finish.`;
        // Capacity is an expected, recoverable app state. Return a successful
        // transport response so the function client does not promote it to an
        // uncaught runtime error; callers inspect `accepted` and keep the UI open.
        return json({ accepted: false, error: msg, code: cap.reason, capacity: cap });
      }
    }

    // Creation is free. Editing a finished track costs EDIT_COST (charged below).
    const EDIT_COST = 2;
    let coinCost = 0;

    // If this generation came from a portal, force the hardcoded language into the Suno prompt
    let portalLanguage: string | null = null;
    if (portalId) {
      const { data: p } = await admin
        .from("portals")
        .select("language, status, coin_cost_per_generation")
        .eq("id", portalId)
        .maybeSingle();
      if (!p) return json({ error: "Portal not found" }, 404);
      if (p.status === "maintenance") return json({ error: "Portal is in maintenance mode" }, 423);
      portalLanguage = p.language ?? null;
      // Portal language must reach the voice even when lyrics were supplied.
      if (portalLanguage && !languageStyleHint) {
        style = limitText(
          [`vocals sung in ${portalLanguage}, ${languageVoiceHint([portalLanguage])}`, style]
            .filter(Boolean)
            .join(", "),
          MAX_STYLE_CHARS,
        );
      }
      // Portal generations follow the same free-until-download rule.
    }
    // Language goes in the style hint only — never into sung lyrics.
    const effectiveLyrics = lyrics ? sanitizeLyrics(lyrics) || lyrics : lyrics;
    const effectivePrompt =
      !lyrics && portalLanguage ? `[Language: ${portalLanguage}] ${prompt}` : prompt;

    const generationStartedAt = new Date().toISOString();

    // Idempotency: if reusing an existing draft, atomically flip its status
    // from a chargeable state (draft/failed) to 'pending' BEFORE deducting.
    // Concurrent duplicate submissions (double-click, client retries, network
    // retries) all target the same row — only one UPDATE affects a row, the
    // rest see zero rows and short-circuit with 409 without charging.
    let existing: { id: string; user_id: string; status: string } | null = null;
    if (existingSongId) {
      const { data: row, error: exErr } = await admin
        .from("songs")
        .select("id, user_id, status")
        .eq("id", existingSongId)
        .maybeSingle();
      if (exErr) return json({ error: exErr.message }, 500);
      if (!row) return json({ error: "Song not found" }, 404);
      if (row.user_id !== user.id) return json({ error: "Song not found" }, 404);
      if (row.status === "pending" || row.status === "processing") {
        return json(
          { error: "Song is already generating", code: "already_generating", song_id: row.id },
          409,
        );
      }
      // Atomic claim — only one concurrent request wins.
      const { data: claimed, error: claimErr } = await admin
        .from("songs")
        .update({
          status: "pending",
          generation_started_at: generationStartedAt,
          error_message: null,
        })
        .eq("id", existingSongId)
        .in("status", ["draft", "failed", "completed"])
        .select("id")
        .maybeSingle();
      if (claimErr) return json({ error: claimErr.message }, 500);
      if (!claimed) {
        return json(
          {
            error: "Song is already generating",
            code: "already_generating",
            song_id: existingSongId,
          },
          409,
        );
      }
      existing = row;
      // Editing a finished track (re-cook) costs 2 coins, taken once at submit.
      // Retries of failed jobs and first-time creation stay free.
      if (row.status === "completed") {
        const { error: chargeErr } = await admin.rpc("deduct_coins", {
          p_user: user.id,
          p_amount: EDIT_COST,
          p_reference: `edit:${row.id}:${generationStartedAt}`,
        });
        if (chargeErr) {
          await admin
            .from("songs")
            .update({ status: "completed" })
            .eq("id", row.id)
            .eq("status", "pending");
          const insufficient = /insufficient/i.test(chargeErr.message);
          return json(
            {
              error: insufficient
                ? `Editing a track costs ${EDIT_COST} coins — top up to continue`
                : "Could not charge for this edit",
              code: insufficient ? "insufficient_coins" : "charge_failed",
            },
            insufficient ? 402 : 500,
          );
        }
        coinCost = EDIT_COST;
      }
    }

    // Read the current balance for the response without charging creation.
    const chargeReference = existing?.id ?? crypto.randomUUID();
    const { data: currentProfile } = await admin
      .from("profiles")
      .select("coin_balance")
      .eq("id", user.id)
      .single();
    const balance = currentProfile?.coin_balance ?? 0;
    const gifted = false;

    // Create or reuse the song row now that the charge has succeeded.
    let song: { id: string } | null = null;
    if (existing) {
      // Never erase the user's saved "— Idea:" from the wizard.
      const { data: prev } = await admin
        .from("songs")
        .select("prompt")
        .eq("id", existing.id)
        .maybeSingle();
      const prevPrompt = ((prev as { prompt?: string | null } | null)?.prompt ?? "") as string;
      const keepPrompt =
        prevPrompt.includes("— Idea:") && !effectivePrompt.includes("— Idea:")
          ? prevPrompt
          : effectivePrompt;
      const { data: upd, error: updErr } = await admin
        .from("songs")
        .update({
          prompt: keepPrompt,
          style,
          lyrics: effectiveLyrics,
          title,
          status: "pending",
          generation_started_at: generationStartedAt,
          portal_id: portalId,
          audio_path: null,
          sample_path: null,
          stream_audio_url: null,
          error_message: null,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (updErr) {
        await refund(admin, user.id, existing.id, "Failed to reuse draft", coinCost);
        return json({ error: updErr.message }, 500);
      }
      song = upd;
    } else {
      const { data: inserted, error: songErr } = await admin
        .from("songs")
        .insert({
          user_id: user.id,
          prompt: effectivePrompt,
          style,
          lyrics: effectiveLyrics,
          title,
          status: "pending",
          generation_started_at: generationStartedAt,
          portal_id: portalId,
        })
        .select("id")
        .single();
      if (songErr) {
        // Refund against a synthetic reference since we have no song id yet.
        await admin.rpc("refund_generation_charge", {
          p_user: user.id,
          p_amount: coinCost,
          p_reference: crypto.randomUUID(),
        });
        return json({ error: songErr.message }, 500);
      }
      song = inserted;
    }
    const songId = song!.id;

    // Brand-new samples (not a retry of a failed song, not an edit of a
    // finished one): creating is free but needs at least 5 coins, and after
    // 3 unpaid tracks each new sample costs 2 coins until the member unlocks
    // one of their own tracks. Checked and charged atomically in the DB.
    const isNewSample = !existing || existing.status === "draft";
    let sampleTerms: { charged?: number; unpaid_count?: number; warning?: boolean } = {};
    if (isNewSample) {
      const { data: terms, error: termsErr } = await admin.rpc("start_generation_charge", {
        p_user: user.id,
        p_song: songId,
        p_reference: `sample:${songId}:${generationStartedAt}`,
      });
      const t = (terms ?? {}) as {
        ok?: boolean;
        reason?: string;
        balance?: number;
        charged?: number;
        unpaid_count?: number;
        warning?: boolean;
      };
      if (termsErr || !t.ok) {
        // Put the song back as a draft so nothing is lost and it can be
        // started again once the member has coins.
        const minBalance = t.reason === "min_balance";
        const message = minBalance
          ? "You need at least 5 OG coins in your balance to create a song. Making it is free — earn coins by inviting friends, or top up."
          : "Couldn't start your song. Please try again.";
        await admin
          .from("songs")
          .update({ status: "draft", error_message: message })
          .eq("id", songId)
          .eq("status", "pending");
        if (termsErr) console.error("start_generation_charge failed", termsErr.message);
        return json(
          {
            error: message,
            code: minBalance ? "min_balance" : "charge_failed",
            balance: t.balance ?? balance,
            min_balance: 5,
            song_id: songId,
          },
          minBalance ? 402 : 500,
        );
      }
      sampleTerms = t;
      if ((t.charged ?? 0) > 0) coinCost = t.charged!;
    }

    const encoder = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SERVICE_ROLE),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(songId));
    const token = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const callbackUrl = `${SUPABASE_URL}/functions/v1/suno-callback?song_id=${songId}&token=${token}`;

    // Sign the uploaded beat so Suno can fetch it (path is namespaced per user).
    let beatUrl: string | null = null;
    if (vocalsOnly && beatPath) {
      if (!beatPath.startsWith(`${user.id}/`)) {
        await refund(admin, user.id, songId, "Beat does not belong to this user", coinCost);
        return json({ error: "Beat not found" }, 404);
      }
      const { data: signed, error: signErr } = await admin.storage
        .from("beats")
        .createSignedUrl(beatPath, 60 * 60);
      if (signErr || !signed?.signedUrl) {
        await refund(admin, user.id, songId, "Could not read the uploaded beat", coinCost);
        return json({ error: "Could not read the uploaded beat" }, 400);
      }
      beatUrl = signed.signedUrl;
    }
    if (vocalsOnly) {
      await admin
        .from("songs")
        .update({ vocals_only: true, beat_path: beatUrl ? beatPath : null })
        .eq("id", songId);
    }

    const customMode = !!(style || effectiveLyrics || title);
    const sunoTitle = limitText(title || "Untitled track", MAX_TITLE_CHARS);

    // Hidden brand signature: sung quietly inside the audio, at most once per
    // minute. Only the payload sent to Suno carries it — the stored/displayed
    // lyrics stay clean. Instrumental tracks have no vocals, so skip them.
    const isInstrumental = vocalsOnly ? false : instrumental;
    // Pure a cappella: rewrite any production section markers (drops,
    // instrumental breaks, beat switches) as voice-only moments so the engine
    // never hears a word that invites instruments.
    const voiceOnlyLyrics =
      acappella && effectiveLyrics
        ? effectiveLyrics.replace(
            /\[(?:[^\]]*\b(?:drop|instrumental|break|beat|bass|808|solo|interlude|outro beat|intro beat)\b[^\]]*)\]/gi,
            "[Humming vocal interlude — voices only, no instruments]",
          )
        : effectiveLyrics;
    // Only real VIPs get clean tracks with no spoken signature: the VIP role
    // or a paid, active subscription. Free VIP (the free trial, a subscription
    // still in its free trial, "free access for all") keeps the promo tag.
    const [vipRole, subsRes] = await Promise.all([
      admin.rpc("has_role", { _user_id: user.id, _role: "vip" }),
      admin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "active"),
    ]);
    const realVip = !!vipRole.data || (subsRes.count ?? 0) > 0;
    const unsigned = isInstrumental || realVip;
    const signedLyrics = unsigned
      ? voiceOnlyLyrics
      : limitText(injectSignature(voiceOnlyLyrics, { acappella }), MAX_PROMPT_CHARS);
    const signedPrompt = unsigned
      ? effectivePrompt
      : (limitText(
          acappella
            ? `${effectivePrompt}\n\nInclude ONE clearly audible vocal tag, performed by voice alone with no instruments, saying "this track was made by O G Bot dot co dot uk" in English, only once, at the very end of the track.`
            : withSignatureHint(effectivePrompt),
          MAX_PROMPT_CHARS,
        ) ?? effectivePrompt);
    // Preserve the artist's lyrics exactly. A moderation rejection is shown
    // honestly; never silently create a radio edit of an explicit track.
    const submit = async (
      lyricsText: string | null,
      promptText: string | null,
      styleText: string | null,
    ) => {
      const retryPayload = {
        prompt: lyricsText || promptText,
        style:
          (portalLanguage && lyricsText
            ? [`sung entirely in ${portalLanguage}`, styleText].filter(Boolean).join(", ")
            : styleText) || undefined,
        title: customMode ? sunoTitle : undefined,
        customMode,
        instrumental: vocalsOnly ? false : instrumental,
        usesUploadedBeat: !!beatUrl,
        ...(vocalGender ? { vocalGender } : {}),
        model: "V5",
        negativeTags: acappella
          ? `low quality, muddy mix, distorted, lo-fi, amateur, bad vocals, ${NO_INSTRUMENT_NEGATIVES}`
          : "low quality, muddy mix, distorted, lo-fi, amateur, bad vocals",
      };
      // Keep the exact provider request for service-only retries. This contains
      // generated lyrics/settings, never credentials or user account details.
      await admin.from("songs").update({ retry_payload: retryPayload }).eq("id", songId);
      const { usesUploadedBeat: _usesUploadedBeat, ...providerPayload } = retryPayload;
      return await fetch(beatUrl ? SUNO_UPLOAD_COVER_URL : SUNO_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUNO_API_KEY}` },
        body: JSON.stringify({
          ...providerPayload,
          ...(beatUrl ? { uploadUrl: beatUrl } : {}),
          ...(vocalGender ? { vocalGender } : {}),
          model: "V5",
          negativeTags: acappella
            ? `low quality, muddy mix, distorted, lo-fi, amateur, bad vocals, ${NO_INSTRUMENT_NEGATIVES}`
            : "low quality, muddy mix, distorted, lo-fi, amateur, bad vocals",
          callBackUrl: callbackUrl,
        }),
      });
    };

    let taskId: string | null = null;

    for (let attempt = 0; attempt < 1; attempt++) {
      let sunoRes: Response;
      try {
        sunoRes = await submit(signedLyrics, signedPrompt, style);
      } catch (_e) {
        await refund(admin, user.id, songId, "Suno API unreachable", coinCost);
        return json({
          accepted: false,
          error: "The music engine is unreachable right now. Try again in a moment.",
        });
      }

      const sunoText = await sunoRes.text();
      let sunoBody: any = {};
      try {
        sunoBody = JSON.parse(sunoText);
      } catch {
        /* keep empty */
      }

      const codeNum =
        typeof sunoBody?.code === "number" ? sunoBody.code : sunoRes.ok ? 200 : sunoRes.status;
      const reason = sunoBody?.msg || sunoBody?.message || `Suno API ${codeNum}`;
      taskId = sunoBody?.data?.taskId ?? sunoBody?.taskId ?? sunoBody?.task_id ?? null;

      if (sunoRes.ok && codeNum === 200 && taskId) break;

      console.error("Suno rejected task", codeNum, reason);

      const friendly = isModerationRejection(reason) ? MODERATION_MESSAGE : reason;
      await refund(admin, user.id, songId, friendly, coinCost);
      return json({ accepted: false, error: friendly, code: codeNum });
    }

    if (!taskId) {
      await refund(admin, user.id, songId, "Suno did not return a task ID", coinCost);
      return json({
        accepted: false,
        error: "The music engine didn't accept the job. Your coins were refunded.",
      });
    }

    await admin
      .from("songs")
      .update({
        status: "processing",
        suno_task_id: taskId,
        failure_class: "retryable",
        next_retry_at: new Date(Date.now() + 8 * 60_000).toISOString(),
      })
      .eq("id", songId);

    return json({
      accepted: true,
      song_id: songId,
      task_id: taskId,
      coin_balance: sampleTerms.charged ? balance - sampleTerms.charged : balance,
      sample_charged: sampleTerms.charged ?? 0,
      unpaid_count: sampleTerms.unpaid_count ?? null,
      sample_fee_warning: !!sampleTerms.warning,
      gifted,
    });
  } catch (e) {
    console.error("Unhandled error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

async function refund(admin: any, userId: string, songId: string, reason: string, amount: number) {
  const terminal = isModerationRejection(reason);
  await admin
    .from("songs")
    .update({
      status: "failed",
      error_message: reason,
      suno_task_id: null,
      failure_class: terminal ? "terminal" : "retryable",
      next_retry_at: terminal ? null : new Date(Date.now() + 60_000).toISOString(),
    })
    .eq("id", songId);
  const { error } = await admin.rpc("refund_generation_charge", {
    p_user: userId,
    p_amount: amount,
    p_reference: songId,
  });
  if (error) console.error("Refund failed", error.message);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
