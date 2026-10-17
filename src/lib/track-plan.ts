import type { WizardResult } from "@/components/library/CreateNowWizard";

const MIN_TRACK_MINUTES = 3;

/** Same song plan the members' studio stages (see createSong in the library). */
export function buildTrackPlan(v: WizardResult) {
  const title = v.title.trim();
  const subject = v.subjectName.trim();
  const style = v.style.trim();
  const language = (v.language || "English").trim();
  const details = v.description.trim();
  const vocal = (v.vocal || "Mix voice").trim();
  const vocalsOnly = !!v.vocalsOnly;
  const beatPath = (v.beatPath || "").trim();
  const intensity = Math.max(0, Math.min(3, Math.round(v.foulIntensity || 0)));
  const foulMouth = v.foulMouth && intensity > 0;
  const targetSec = Math.max(MIN_TRACK_MINUTES, v.targetMinutes || MIN_TRACK_MINUTES) * 60;
  const vocalsOnlyTags = vocalsOnly
    ? beatPath
      ? ["vocals only", "a cappella over the uploaded beat", "no added instruments"]
      : [
          "a cappella",
          "vocals only",
          "unaccompanied voice",
          "humming and vocal harmonies only",
          "no instruments",
          "no drums",
          "no percussion",
          "no bass",
          "no synths",
        ]
    : [];
  const styleTags = style
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(vocalsOnlyTags);
  const earlyStyle = [style, vocal, ...vocalsOnlyTags].filter(Boolean).join(", ");
  const prompt =
    ([
      title,
      subject ? `For: ${subject}` : null,
      earlyStyle ? `Style: ${earlyStyle}` : null,
      language ? `Language: ${language}` : null,
    ]
      .filter(Boolean)
      .join(" — ") ||
      title ||
      "Untitled") + (details ? `\n— Idea: ${details}` : "");
  return {
    row: {
      title: title || null,
      prompt,
      style: earlyStyle || null,
      vocals_only: vocalsOnly,
      beat_path: beatPath || null,
      target_duration_sec: targetSec,
      is_public: v.isPublic ?? true,
      foul_mouth: foulMouth,
      foul_intensity: intensity,
      is_nasheed: !!v.isNasheed,
    },
    plan: {
      lyrics: {
        songName: title,
        description: style,
        styleTags,
        language,
        vocal,
        foulMouth,
        foulIntensity: intensity,
        personalDetails: details || undefined,
        subjectName: subject || undefined,
        targetDurationSec: targetSec,
        vocalsOnly,
      } as Record<string, unknown>,
      suno: {
        prompt,
        title: title || null,
        style: style || null,
        language: language || null,
        vocal: vocal || null,
        vocals_only: vocalsOnly,
        beat_path: beatPath || null,
        target_duration_sec: targetSec,
      } as Record<string, unknown>,
    },
  };
}
