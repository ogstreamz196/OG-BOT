import { useServerFn } from "@tanstack/react-start";
import { purchaseOwnerTrack } from "@/lib/track-unlock.functions";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionRunState } from "@/hooks/use-session-run-state";
import { Link, useNavigate } from "@tanstack/react-router";
import { requestFullTrackPlay } from "@/lib/full-track-autoplay";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  FileText,
  ChevronDown,
  Coins,
  Check,
  Sparkles,
  Music2,
  AlertCircle,
  Play,
  RefreshCw,
  Download,
  Lock,
} from "lucide-react";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useSettings } from "@/hooks/use-settings";
import {
  useFoulIntensity,
  useFoulMouth,
  useSetFoulIntensity,
  useSetFoulMouth,
} from "@/hooks/use-foul-mouth";

import { useProfile } from "@/hooks/use-profile";
import { useVariations } from "@/hooks/use-variations";
import { readInvokeError } from "@/lib/invoke-error";
import { announceSampleCharge, confirmGenerationAllowed } from "@/lib/generation-terms";
import { cn } from "@/lib/utils";
import { CoinPill } from "@/components/ui/coin-pill";
import { type Stage } from "./song-workspace/StageStepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VariationsCard } from "./song-workspace/VariationsCard";
import { UnlockConfirmDialog } from "./UnlockConfirmDialog";
import { QuickTopUpSheet } from "@/components/store/QuickTopUpSheet";
import type { WorkspaceSong } from "./song-workspace/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useRole } from "@/hooks/use-role";
import { POOLS, orderLanguages, isFreeStyle } from "@/lib/library-utils";
import { LENGTH_OPTIONS, MIN_LENGTH, MAX_LENGTH } from "./CreateNowWizard";

const LANGUAGES = orderLanguages([
  "English",
  "Spanish",
  "French",
  "Portuguese",
  "Hindi",
  "Gujarati",
  "Marathi",
  "Bengali",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Urdu",
  "Punjabi",
  "Arabic",
  "Swahili",
  "Patois",
  "Yoruba",
  "German",
  "Italian",
  "Romanian",
  "Filipino",
  "Tagalog",
  "Cebuano",
  "Mandarin",
  "Japanese",
  "Korean",
  "Turkish",
  "Russian",
  "Polish",
  "Dutch",
  "Greek",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Hebrew",
  "Lithuanian",
]);

const LANG_RE = /Language:\s*(?:write the lyrics in\s*)?([A-Za-z][A-Za-z\s+]{1,80})/i;

const VOCALS = ["Mix voice", "Female vocal", "Male vocal", "Duo"];

/** Styles offered as chips — curated first, then the rest of the pool. */
const STYLE_OPTIONS: string[] = (() => {
  const featured = [
    "Hip Hop",
    "Rap",
    "Singing",
    "Drill",
    "Trap",
    "Drum & Bass",
    "Pop",
    "K-Pop",
    "Slow Jam",
    "Bhangra",
    "Nasheed",
    "Nursery Rhyme",
  ];
  const rest = POOLS.genre.filter((g) => !featured.includes(g));
  return [...featured, ...rest];
})();

function toggleItem(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Split a saved style string into known chips + custom leftovers. */
function splitStyles(style: string | null | undefined): { known: string[]; extra: string } {
  const parts = (style ?? "")
    .split(/[,·]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const known: string[] = [];
  const extra: string[] = [];
  for (const p of parts) {
    if (/^(?:any voice|mix(?:ed)? voice|female vocal|male vocal|duo|duet)$/i.test(p)) continue;
    const match = STYLE_OPTIONS.find((s) => s.toLowerCase() === p.toLowerCase());
    if (match) {
      if (!known.includes(match)) known.push(match);
    } else extra.push(p);
  }
  return { known, extra: extra.join(", ") };
}

/** Recover the voice choice from the saved style tags. */
function detectVocal(style: string | null | undefined): string {
  const s = (style ?? "").toLowerCase();
  if (s.includes("mix voice") || s.includes("mixed voice")) return "Mix voice";
  if (s.includes("duet") || s.includes("duo")) return "Duo";
  if (s.includes("female")) return "Female vocal";
  if (s.includes("male")) return "Male vocal";
  return "Mix voice";
}

function detectLanguages(text: string | null | undefined): string[] {
  const m = text?.match(LANG_RE);
  const found = m?.[1]?.trim();
  if (!found) return ["English"];
  const picked = found
    .split("+")
    .map((p) => p.trim())
    .map((p) => LANGUAGES.find((l) => l.toLowerCase() === p.toLowerCase()))
    .filter((l): l is string => !!l);
  return picked.length ? Array.from(new Set(picked)) : ["English"];
}

function setBriefLanguage(brief: string, language: string): string {
  const line = `Language: write the lyrics in ${language}`;
  if (LANG_RE.test(brief)) return brief.replace(LANG_RE, line);
  return brief.trim() ? `${brief.trim()}\n${line}` : line;
}

// The wizard saves the user's original idea inside the prompt as "— Idea: …"
// (the dash stops the language matcher from swallowing it).
const IDEA_RE = /\n?— Idea:\s*([\s\S]*?)(?=\nLanguage:|$)/;
function getIdea(brief: string): string {
  return (brief.match(IDEA_RE)?.[1] ?? "").trim();
}
function setIdea(brief: string, idea: string): string {
  const base = brief.replace(IDEA_RE, "").trimEnd();
  const clean = idea.trim();
  return clean ? `${base}\n— Idea: ${clean}` : base;
}

interface Props {
  song: WorkspaceSong;
  onSaved?: () => void;
  onRefresh?: () => void;
}

/**
 * 3-stage music creation workflow:
 *   1. Lyrics       — user crafts a brief and generates lyrics for free
 *   2. Sample       — generate and listen while the full file finishes downloading
 *   3. Final song   — unlock the full download with coins or a one-off card payment
 */
export function SongWorkspace({ song, onSaved, onRefresh }: Props) {
  const { data: settings } = useSettings();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const refreshCoinBalance = () => {
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  };
  const { foulMouth } = useFoulMouth();
  const { intensity: foulIntensity } = useFoulIntensity();
  const setFoulMouth = useSetFoulMouth();
  const setFoulIntensity = useSetFoulIntensity();
  const [foulIntensityLocal, setFoulIntensityLocal] = useState<number | null>(null);
  const displayedFoulIntensity = foulIntensityLocal ?? foulIntensity;

  const lyricsCost = settings?.coins_per_lyrics_generation ?? 0;
  const previewCost = settings?.coins_per_generation ?? 0;
  const fullUnlockCost = settings?.coins_per_full_unlock ?? 5;
  const unlockCost = fullUnlockCost;
  const balance = profile?.coin_balance ?? 0;
  const isOwner = !!profile?.id && song.user_id === profile.id;
  // Re-cooking a finished track is an edit: 2 coins, charged once on submit.
  const editCost = song.status === "completed" ? 2 : 0;

  const [title] = useState(song.title ?? "");
  const [brief, setBrief] = useState(song.prompt ?? "");
  // Styles split into known chips + anything custom the user typed.
  const initialStyles = useMemo(() => splitStyles(song.style), [song.style]);
  const [styles, setStyles] = useState<string[]>(() => initialStyles.known);
  const [styleExtra, setStyleExtra] = useState(() => initialStyles.extra);
  const [vocal, setVocal] = useState(() => detectVocal(song.style));
  const [vocalsOnly, setVocalsOnly] = useState(!!song.vocals_only);
  const [targetMinutes, setTargetMinutes] = useState(() => {
    const mins = Math.round((song.target_duration_sec ?? MIN_LENGTH * 60) / 60);
    return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, mins || MIN_LENGTH));
  });

  const [lyrics, setLyrics] = useState(song.lyrics ?? "");
  const [languages, setLanguages] = useState<string[]>(() => detectLanguages(song.prompt));
  // Progressive disclosure: each step stays folded unless it's the one to act on.
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [step1Open, setStep1Open] = useState(!song.lyrics);
  const [step2Open, setStep2Open] = useState(!!song.lyrics && song.status !== "completed");

  const [saving, setSaving] = useState(false);
  const [genLyrics, setGenLyrics] = useState(false);
  const [genPreview, setGenPreview] = useState(false);
  // True from the moment the user taps "cook" until the NEW take finishes.
  // While true, the old sample is hidden so it can't be mistaken for the new one.
  // Kept app-wide (and across reloads) so leaving the page mid-cook doesn't
  // lose the "cooking your new take" state for this song.
  const [cooking, setCooking] = useSessionRunState<boolean>(`edit-cook:${song.id}`, false, true);
  const [freshReady, setFreshReady] = useSessionRunState<boolean>(
    `edit-fresh:${song.id}`,
    false,
    true,
  );
  const [sawPending, setSawPending] = useSessionRunState<boolean>(
    `edit-saw:${song.id}`,
    false,
    true,
  );
  const sawPendingRef = useRef(sawPending);
  sawPendingRef.current = sawPending;
  const [unlocking, setUnlocking] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [topUp, setTopUp] = useState<{ needed: number; reason: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [recheckActive, setRecheckActive] = useState(false);
  const [recheckCount, setRecheckCount] = useState(0);

  useEffect(() => {
    if (!recheckActive) return;
    if (recheckCount >= 10) {
      setRecheckActive(false);
      toast.error("Song is still missing after refreshing — it may be permanently deleted.");
      return;
    }
    const id = setTimeout(() => {
      try {
        onRefresh?.();
        onSaved?.();
      } catch {
        // Silent retry — single summary toast fires when polling ends.
      }
      setRecheckCount((c) => c + 1);
    }, 3000);
    return () => clearTimeout(id);
  }, [recheckActive, recheckCount, onRefresh, onSaved]);

  useEffect(() => {
    if (!missing && recheckActive) {
      setRecheckActive(false);
      setRecheckCount(0);
      toast.success("Song recovered — back in your library.");
    }
  }, [missing, recheckActive]);

  const lyricsRef = useRef<HTMLTextAreaElement | null>(null);

  // Derived, always-current values for saving + generating.
  const styleTags = useMemo(
    () => [...styles, ...styleExtra.split(/[,·]/).map((s) => s.trim())].filter(Boolean),
    [styles, styleExtra],
  );
  const styleValue = styleTags.join(", ");
  const savedStyleValue = [styleValue, vocal || "Mix voice"].filter(Boolean).join(", ");
  const isNasheed = styleTags.some((style) => style.toLowerCase() === "nasheed");
  const languageValue = useMemo(
    () => Array.from(new Set(languages.length ? languages : ["English"])).join(" + "),
    [languages],
  );
  const nextBriefValue = useMemo(
    () => setBriefLanguage(brief, languageValue),
    [brief, languageValue],
  );
  const languageChanged = languageValue !== detectLanguages(song.prompt).join(" + ");

  const { variations } = useVariations({
    songId: song.id,
    songStatus: song.status,
    balance,
    previewCost,
    onChanged: onSaved,
  });

  const hasLyrics = !!(lyrics && lyrics.trim().length > 20);
  const isPending = song.status === "pending" || song.status === "processing";
  const isReady = song.status === "completed";
  const isFailed = song.status === "failed";

  // Track the re-cook lifecycle: wait until we've seen the row go pending,
  // then finish when it lands on completed/failed.
  useEffect(() => {
    if (!cooking) return;
    if (isPending) {
      if (!sawPendingRef.current) setSawPending(true);
      return;
    }
    if (sawPendingRef.current && (isReady || isFailed)) {
      setSawPending(false);
      setCooking(false);
      if (isReady) setFreshReady(true);
    }
  }, [cooking, isPending, isReady, isFailed, setSawPending, setCooking, setFreshReady]);

  function startCooking() {
    setSawPending(false);
    setFreshReady(false);
    setCooking(true);
  }

  // Realtime + polling fallback: while the song is generating, listen for the row
  // flipping to completed/failed and ask the parent to refetch so the UI moves
  // from "Sample" → "Full ready" automatically.
  const lastStatus = useRef(song.status);
  useEffect(() => {
    if (!isPending) {
      if (lastStatus.current === "pending" || lastStatus.current === "processing") {
        if (isReady) toast.success("Sample ready — full track unlocked");
        else if (isFailed) toast.error(song.error_message || "Generation failed — coins refunded");
        // Refresh coin balance after generation settles (unlock cost or refund).
        refreshCoinBalance();
      }
      lastStatus.current = song.status;
      return;
    }
    lastStatus.current = song.status;

    const channel = supabase
      .channel(`song-${song.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "songs", filter: `id=eq.${song.id}` },
        (payload) => {
          const next = (payload.new as { status?: string })?.status;
          if (next && next !== lastStatus.current) onSaved?.();
        },
      )
      .subscribe();

    // Tight 2s polling fallback in case Realtime drops a message.
    const poll = setInterval(() => onSaved?.(), 2000);
    // Refresh the coin balance every 5s while a job is in flight — belt & braces
    // for the realtime profile subscription, so users see refunds/deductions
    // land even if the socket blips.
    const coinPoll = setInterval(refreshCoinBalance, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      clearInterval(coinPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.status]);

  // Elapsed-seconds counter for the Generate button while a job is in flight.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isPending) {
      setElapsed(0);
      return;
    }
    const startedAt = song.generation_started_at
      ? new Date(song.generation_started_at).getTime()
      : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isPending, song.generation_started_at]);

  const stage: Stage = isReady ? 3 : hasLyrics ? 2 : 1;
  const [tab, setTab] = useState<string>(
    isReady ? "preview" : hasLyrics ? "preview" : "lyrics",
  );

  const dirty =
    savedStyleValue !== (song.style ?? "") ||
    nextBriefValue !== (song.prompt ?? "") ||
    lyrics !== (song.lyrics ?? "") ||
    vocalsOnly !== !!song.vocals_only ||
    vocal !== detectVocal(song.style) ||
    targetMinutes * 60 !== (song.target_duration_sec ?? MIN_LENGTH * 60);

  async function persist(patch: TablesUpdate<"songs">) {
    // Community songs aren't editable by the viewer — skip persistence, keep generation working.
    if (!isOwner) return;
    const { error } = await supabase.from("songs").update(patch).eq("id", song.id);
    if (error) throw error;
  }

  /** Save every editable selection (everything except name/story) plus lyrics. */
  async function saveSettingsPatch() {
    if (nextBriefValue !== brief) setBrief(nextBriefValue);
    await persist({
      prompt: nextBriefValue,
      style: savedStyleValue || null,
      lyrics: lyrics.trim() || null,
      vocals_only: vocalsOnly,
      target_duration_sec: targetMinutes * 60,
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettingsPatch();
      toast.success("Changes saved");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function generateLyrics() {
    if (missing) {
      toast.error("This song is no longer available");
      return;
    }

    if (!brief.trim() && !title.trim()) {
      toast.error("Add a title or a brief first");
      return;
    }
    if (balance < lyricsCost) {
      setTopUp({ needed: lyricsCost, reason: "write these lyrics" });
      return;
    }
    setGenLyrics(true);
    startCooking();
    let started = false;
    // Jump straight to Preview so the cooking visuals show immediately.
    setTab("preview");
    requestAnimationFrame(() =>
      document
        .getElementById("studio-preview")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    try {
      await saveSettingsPatch();

      const { data, error } = await supabase.functions.invoke("generate-lyrics", {
        body: {
          song_id: isOwner ? song.id : null,
          songName: title.trim(),
          description: nextBriefValue.trim(),
          styleTags: styleTags,
          vocal: vocal || "Mix voice",
          vocals_only: vocalsOnly,
          targetDurationSec: targetMinutes * 60,
          foulMouth: isNasheed ? false : foulMouth,
          foulIntensity: displayedFoulIntensity,
          language: languageValue,
          personalDetails: getIdea(nextBriefValue) || undefined,
        },
      });

      if (error) {
        const msg = await readInvokeError(error, "Lyrics generation failed");
        toast.error(
          msg.toLowerCase().includes("insufficient")
            ? "Not enough coins for a lyrics generation"
            : msg,
        );
        return;
      }
      const next = (data?.lyrics ?? "").toString();
      if (!next) {
        toast.error("No lyrics returned");
        return;
      }
      setLyrics(next);
      toast.success("Lyrics ready — cooking your track now", {
        description: "Your preview will appear at the bottom when it's done.",
      });
      onSaved?.();
      // Straight into the track: no second button to hunt for.
      setGenLyrics(false);
      setTab("preview");
      started = await generatePreview(next);
      requestAnimationFrame(() =>
        document
          .getElementById("studio-preview")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lyrics generation failed");
    } finally {
      setGenLyrics(false);
      if (!started) setCooking(false);
    }
  }

  // Single "Cook now": apply any edits, rewrite lyrics only when needed
  // (none yet, or the language changed), otherwise cook the current lyrics.
  async function cookNow() {
    if (dirty) {
      setSaving(true);
      try {
        await saveSettingsPatch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save changes");
        return;
      } finally {
        setSaving(false);
      }
    }
    // Changing the idea, styles, voice or language rewrites the lyrics so the
    // new track really reflects the edit — unless the user hand-edited lyrics.
    const lyricsHandEdited = lyrics !== (song.lyrics ?? "");
    const ideaChanged = getIdea(nextBriefValue) !== getIdea(song.prompt ?? "");
    const styleChanged = savedStyleValue !== (song.style ?? "");
    if (!hasLyrics || languageChanged || ((ideaChanged || styleChanged) && !lyricsHandEdited)) {
      await generateLyrics();
    } else {
      await cookCurrentLyrics();
    }
  }

  async function cookCurrentLyrics() {
    setTab("preview");
    requestAnimationFrame(() =>
      document
        .getElementById("studio-preview")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    await generatePreview();
  }

  const submitLockRef = useRef(false);
  async function generatePreview(lyricsOverride?: string): Promise<boolean> {
    const useLyrics = typeof lyricsOverride === "string" ? lyricsOverride : lyrics;
    if (submitLockRef.current) return false;
    if (missing) {
      toast.error("This song is no longer available");
      return false;
    }

    if (!useLyrics.trim()) {
      toast.error("Generate lyrics first");
      return false;
    }
    if (balance < previewCost + editCost) {
      setTopUp({ needed: previewCost + editCost, reason: "edit this track" });
      return false;
    }
    // A draft (or someone else's song) becomes a brand-new sample: free, but
    // needs 5 coins, and costs 2 coins after 3 unpaid tracks.
    if ((!isOwner || song.status === "draft") && !(await confirmGenerationAllowed())) {
      return false;
    }
    submitLockRef.current = true;
    setGenPreview(true);
    startCooking();
    let ok = false;
    try {
      localStorage.setItem("welcome.personal_banner.dismissed", "1");
    } catch {
      // storage may be blocked (private mode)
    }
    try {
      window.dispatchEvent(new CustomEvent("og:generate-start"));
    } catch {
      // storage may be blocked (private mode)
    }
    try {
      if (dirty && lyricsOverride === undefined) await saveSettingsPatch();
      const { data, error } = await supabase.functions.invoke("suno-generate", {
        body: {
          song_id: isOwner ? song.id : null,
          prompt: nextBriefValue,
          lyrics: useLyrics,
          title: title.trim() || null,
          style: styleValue || song.style || null,
          language: languageValue,
          vocal: vocal || "Mix voice",
          vocals_only: vocalsOnly,
          beat_path: song.beat_path ?? null,
          target_duration_sec: targetMinutes * 60,
        },
      });

      if (error) {
        const msg = await readInvokeError(error, "Could not start generation");
        if (/already generating/i.test(msg)) {
          // A duplicate tap/auto-start raced the first request — that one is cooking.
          ok = true;
          onSaved?.();
        } else if (/song not found/i.test(msg)) {
          setMissing(true);
          toast.error(
            "This song is no longer available — it may have been deleted. Start a new one from the studio.",
          );
        } else {
          toast.error(msg);
        }
      } else if (data?.accepted === false) {
        toast.info(data.error || "Your current generations need to finish first");
      } else {
        ok = true;
        announceSampleCharge(data);
        toast.success(
          editCost > 0
            ? `${editCost} OG coins used · OG Bot is cooking your new take`
            : "OG Bot is cooking your new take",
        );
        refreshCoinBalance();
        onSaved?.();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start generation");
    } finally {
      setGenPreview(false);
      submitLockRef.current = false;
      if (!ok) setCooking(false);
    }
    return ok;
  }

  async function unlockFull() {
    if (!isReady) return;
    // Already-unlocked owners skip the confirmation modal — they've already paid.
    if (ownsFull) {
      await performUnlock();
      return;
    }
    setUnlockDialogOpen(true);
  }

  const navigate = useNavigate();
  const { isVip: isVipUser, isBoss } = useRole();
  // Boss accounts play and download everything, so treat them as owners.
  const ownsFull = !!song.unlocked || !!isBoss;
  const buyOwnerTrack = useServerFn(purchaseOwnerTrack);
  async function performUnlock() {
    setUnlocking(true);
    try {
      if (!ownsFull) {
        const data = await buyOwnerTrack({ data: { songId: song.id } });
        if (!data?.already) toast.success(`Unlocked + Take 2 free · -${data?.cost ?? unlockCost} coins`);
        void queryClient.invalidateQueries({ queryKey: ["library"] });
        void queryClient.invalidateQueries({ queryKey: ["recent-songs"] });
        void queryClient.invalidateQueries({ queryKey: ["variations"] });
        refreshCoinBalance();
        onSaved?.();
      }
      const { data: urlData, error: urlErr } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download" },
      });
      if (urlErr || !urlData?.url) {
        toast.error("Unlocked, but download link failed — try again in a moment");
        return;
      }
      const fileName = `${song.title || "song"}.mp3`;
      const blob = await downloadFile(urlData.url as string, fileName);
      setUnlockDialogOpen(false);
      await shareTrack({
        title: song.title || "My track",
        blob,
        filename: fileName,
        songId: song.id,
      });
      // Payment complete — refresh so the preview flips to the full track.
      refreshCoinBalance();
      onSaved?.();
      onRefresh?.();
      // Stay on the track: the player swaps to the full version and carries on
      // from where the sample stopped.
      requestFullTrackPlay(song.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unlock");
    } finally {
      setUnlocking(false);
    }
  }

  if (missing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive"
          >
            <AlertCircle className="h-3.5 w-3.5" /> Song removed
          </span>
        </div>
        <Card className="border-dashed border-destructive/40 bg-card/60">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">This song is no longer available</h3>
              <p className="text-sm text-muted-foreground">
                It may have been deleted. Refresh your library to load the latest list, or head back
                to the studio to start a new one.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => {
                  setMissing(false);
                  setRecheckCount(0);
                  setRecheckActive(true);
                  onRefresh?.();
                  onSaved?.();
                }}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" /> Refresh Library
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link to="/library">Back to My Library</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isPending && tab !== "preview" && (
        <div className="sticky top-2 z-30">
          <GeneratingProgress
            sampleSeconds={settings?.sample_seconds ?? 60}
            startedAt={song.generation_started_at ?? song.updated_at ?? song.created_at}
            taskId={song.suno_task_id}
            hasLivePreview={!!song.stream_audio_url}
            songId={song.id}
            onCancelled={onSaved}
          />
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3 p-1">
          <TabsTrigger value="lyrics" className="text-xs sm:text-sm">Edit</TabsTrigger>
          <TabsTrigger value="preview" className="text-xs sm:text-sm">Preview</TabsTrigger>
          <TabsTrigger value="takes" className="text-xs sm:text-sm">Takes</TabsTrigger>
        </TabsList>

        <TabsContent value="lyrics" className="mt-0">
        <Card>
          <Collapsible open>
            <CollapsibleTrigger className="pointer-events-none flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5 [&>svg]:hidden">
              <div className="min-w-0">
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />Lyrics & vibe
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {hasLyrics ? "Tweak, save, re-cook" : "Write the lyrics · Free"}
                </span>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {/* Original idea from the wizard — editable, rewrites lyrics on Cook now */}
                <div className="space-y-2">
                  <Label htmlFor="song-idea">
                    Your idea{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (change it and Cook now writes fresh lyrics)
                    </span>
                  </Label>
                  <Textarea
                    id="song-idea"
                    value={getIdea(brief)}
                    onChange={(e) => setBrief((b) => setIdea(b, e.target.value))}
                    placeholder="What's the song about? Names, stories, inside jokes…"
                    rows={3}
                    maxLength={500}
                    disabled={!isOwner}
                  />
                </div>

                {/* Styles — stack as many as you like */}
                <div className="space-y-2">
                  <Label>
                    Styles{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (pick one or more)
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLE_OPTIONS.map((s) => {
                      const on = styles.includes(s);
                      const locked = !isVipUser && !isFreeStyle(s) && !on;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            if (locked) {
                              toast(`👑 ${s} is an OG VIP style`, {
                                description: "Unlock all 50+ styles & moods, plus custom requests.",
                                action: { label: "Get VIP", onClick: () => void navigate({ to: "/buy-coins" }) },
                              });
                              return;
                            }
                            if (s === "Nasheed") {
                              setStyles(on ? [] : ["Nasheed"]);
                              setStyleExtra("");
                              setVocalsOnly(!on);
                              if (!on) {
                                setFoulIntensityLocal(0);
                                setFoulIntensity.mutate(0);
                                if (foulMouth) setFoulMouth.mutate(false);
                              }
                              return;
                            }
                            setStyles((list) =>
                              toggleItem(
                                list.filter((style) => style !== "Nasheed"),
                                s,
                              ),
                            );
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            on
                              ? "border-primary bg-primary/15 text-foreground shadow-[0_0_14px_-6px_hsl(var(--primary))]"
                              : "border-border bg-background/40 text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          {locked && <span className="mr-1">🔒👑</span>}
                          {s}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    id="song-style-extra"
                    value={styleExtra}
                    onChange={(e) => setStyleExtra(e.target.value)}
                    placeholder="Add your own, e.g. dark piano, 90s boom bap"
                  />
                </div>

                {/* Languages — multi select, English always included */}
                <div className="space-y-2">
                  <Label>
                    Languages{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (mix as many as you like)
                    </span>
                  </Label>
                  <details className="group rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
                    <span className="truncate">{languages.join(" + ")}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {LANGUAGES.map((l) => {
                      const on = languages.includes(l);
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setLanguages((list) => {
                              const next = toggleItem(list, l);
                              return next.length ? next : ["English"];
                            })
                          }
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            on
                              ? "border-primary bg-primary/15 text-foreground"
                              : "border-border bg-background/40 text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          {l}
                        </button>
                      );
                    })}
                  </div>
                  </details>
                </div>

                {/* Voice + length */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="song-vocal">Voice</Label>
                    <Select value={vocal || "Mix voice"} onValueChange={setVocal}>
                      <SelectTrigger id="song-vocal">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VOCALS.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="song-length">Track length</Label>
                    <Select
                      value={String(targetMinutes)}
                      onValueChange={(v) => setTargetMinutes(Number(v))}
                    >
                      <SelectTrigger id="song-length">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LENGTH_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {m} min
                            {m > MIN_LENGTH
                              ? ` · +${m - MIN_LENGTH} coin${m - MIN_LENGTH === 1 ? "" : "s"}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Vocals only */}
                <label
                  htmlFor="vocals-only-toggle"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm font-medium"
                >
                  <span className="min-w-0">
                    Vocals only {isNasheed ? "· REQUIRED" : vocalsOnly ? "· ON" : "· OFF"}
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {isNasheed
                        ? "Nasheed stays strictly voice-only with no music or instruments."
                        : "A cappella vocals with no generated instrumental."}
                    </span>
                  </span>
                  <Switch
                    id="vocals-only-toggle"
                    checked={vocalsOnly}
                    onCheckedChange={setVocalsOnly}
                    disabled={isNasheed}
                  />
                </label>

                {hasLyrics && languageChanged && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
                    Language changed to <b>{languageValue}</b> — Cook now will rewrite the lyrics.
                  </div>
                )}

                <Collapsible open={lyricsOpen} onOpenChange={setLyricsOpen}>
                  <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger className="flex min-w-0 items-center gap-2 text-sm font-semibold hover:text-primary">
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform",
                          lyricsOpen && "rotate-180",
                        )}
                      />
                      <span className="truncate">
                        {lyricsOpen ? "Hide lyrics" : "View / edit lyrics"}
                      </span>
                    </CollapsibleTrigger>
                    {hasLyrics && !genLyrics && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-500">
                        <Check className="h-3 w-3" /> Ready
                      </span>
                    )}
                    {genLyrics && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" /> Writing…
                      </span>
                    )}
                  </div>
                  {genLyrics ? (
                    <div className="pt-3">
                      <LyricsSkeleton songId={song.id} />
                    </div>
                  ) : (
                    <CollapsibleContent className="pt-3">
                      <Label htmlFor="song-lyrics" className="sr-only">
                        Lyrics
                      </Label>
                      <Textarea
                        ref={lyricsRef}
                        id="song-lyrics"
                        value={lyrics}
                        onChange={(e) => setLyrics(e.target.value)}
                        rows={12}
                        placeholder={
                          "Tap Generate lyrics below — or paste your own.\n\n[Verse 1]\n…\n[Chorus]\n…"
                        }
                        className="font-mono text-sm"
                      />
                    </CollapsibleContent>
                  )}
                </Collapsible>

                <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:justify-end sm:gap-3">
                  {dirty && (
                    <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
                  )}
                  <label
                    htmlFor="foul-mouth-toggle"
                    className="col-span-2 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs font-medium sm:col-span-1 sm:flex sm:w-auto sm:py-1.5"
                    title="Allow explicit language in generated lyrics"
                  >
                    <span aria-hidden>🤬</span>
                    <span className="min-w-0 whitespace-normal">Foul Mouth</span>
                    <Switch
                      id="foul-mouth-toggle"
                      checked={foulMouth}
                      onCheckedChange={(explicit) => {
                        const value = explicit ? 3 : 0;
                        setFoulIntensityLocal(value);
                        setFoulIntensity.mutate(value);
                        setFoulMouth.mutate(explicit);
                      }}
                      disabled={setFoulMouth.isPending || setFoulIntensity.isPending || isNasheed}
                    />
                  </label>
                  {!isNasheed && (
                    <div className="col-span-2 grid w-full grid-cols-[auto_minmax(7rem,1fr)_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 sm:col-span-1 sm:w-64">
                      <span className="text-[10px] font-semibold text-muted-foreground">Clean</span>
                      <Slider
                        aria-label="Swearing intensity"
                        min={0}
                        max={3}
                        step={1}
                        value={[displayedFoulIntensity]}
                        onValueChange={(values) =>
                          setFoulIntensityLocal(
                            Math.max(0, Math.min(3, Math.round(values[0] ?? 3))),
                          )
                        }
                        onValueCommit={(values) => {
                          const value = Math.max(0, Math.min(3, Math.round(values[0] ?? 3)));
                          setFoulIntensityLocal(value);
                          setFoulIntensity.mutate(value);
                          if (value > 0 !== foulMouth) setFoulMouth.mutate(value > 0);
                        }}
                      />
                      <span className="text-[10px] font-semibold text-destructive">Savage</span>
                    </div>
                  )}
                  <Button
                    onClick={() => void cookNow()}
                    disabled={genLyrics || genPreview || isPending || cooking || saving || missing}
                    className="col-span-2 min-w-0 gap-2"
                  >
                    {genLyrics || genPreview || saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {editCost > 0 ? `Cook now · ${editCost} coins` : "Cook now"}
                  </Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
        </TabsContent>

        <TabsContent value="preview" id="studio-preview" className="mt-0 scroll-mt-20">
        {/* Stage 2 — Sample */}
        <Card>
          <Collapsible open>
            <CollapsibleTrigger className="pointer-events-none flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5 [&>svg]:hidden">
              <div className="min-w-0">
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <Play className="h-4 w-4 shrink-0 text-primary" />Preview
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {cooking
                    ? "Cooking your new version…"
                    : isReady && ownsFull
                    ? "Full track ready"
                    : isReady
                    ? `Free ${settings?.sample_seconds ?? 60}s sample ready`
                    : isPending
                      ? "Generating…"
                      : `Free ${settings?.sample_seconds ?? 60}s sample`}
                </span>
              </div>
              <ChevronDown
                className={cn("h-5 w-5 shrink-0 transition-transform", step2Open && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3">
                {!hasLyrics && !genLyrics && (
                  <p className="text-sm text-muted-foreground">Generate lyrics in step 1 first.</p>
                )}
                {!isPending && (genLyrics || genPreview || cooking) && (
                  <LyricsSkeleton songId={song.id} />
                )}
                {isPending && (
                  <>
                    <GeneratingProgress
                      sampleSeconds={settings?.sample_seconds ?? 60}
                      startedAt={song.generation_started_at ?? song.updated_at ?? song.created_at}
                      taskId={song.suno_task_id}
                      hasLivePreview={!!song.stream_audio_url}
                      songId={song.id}
                      onCancelled={onSaved}
                    />
                    {song.stream_audio_url && (
                      <LiveStreamPreview streamUrl={song.stream_audio_url} limitSeconds={35} />
                    )}
                  </>
                )}
                {isFailed && !cooking && (
                  <div
                    role="alert"
                    className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">Generation failed</p>
                        <p className="mt-0.5 text-xs opacity-90">
                          {song.error_message || "Something went wrong on OG Bot's side."} Your
                          coins were refunded automatically.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void generatePreview()}
                        disabled={!hasLyrics || genPreview || balance < previewCost || missing}
                        className="gap-1.5"
                      >
                        {genPreview ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Try again
                        <span className="ml-0.5 rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-semibold">
                          Free
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTab("lyrics");
                          setLyricsOpen(true);
                          requestAnimationFrame(() =>
                            lyricsRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            }),
                          );
                        }}
                        className="gap-1.5"
                      >
                        <FileText className="h-3.5 w-3.5" /> Tweak lyrics
                      </Button>
                      {balance < previewCost && (
                        <Button asChild size="sm" variant="secondary" className="gap-1.5">
                          <Link to="/buy-coins">
                            <Coins className="h-3.5 w-3.5" /> Top up coins
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {isReady && !genLyrics && !genPreview && !cooking && (
                  <>
                    {freshReady && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4" /> Your new take is ready!
                        </span>
                        <button
                          type="button"
                          onClick={() => setTab("takes")}
                          className="text-xs font-medium underline underline-offset-2"
                        >
                          Compare takes
                        </button>
                      </div>
                    )}
                    <InlineSamplePlayer
                      key={`${song.id}-${song.updated_at ?? ""}`}
                      songId={song.id}
                      unlocked={!!song.unlocked}
                    />
                  </>
                )}
                {!isReady && !cooking && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    onClick={() => void generatePreview()}
                    disabled={
                      !hasLyrics || genPreview || isPending || balance < previewCost || missing
                    }
                    aria-busy={genPreview || isPending}
                    className="gap-2"
                  >
                    {genPreview || isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isReady ? (
                      <RefreshCw className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {genPreview
                      ? "Starting…"
                      : isPending
                        ? `Generating… ${elapsed}s`
                        : isReady
                          ? "Regenerate sample"
                          : "Generate preview"}
                    <span className="ml-1 rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-semibold">
                      Free
                    </span>
                  </Button>
                </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
          {isReady && !cooking && (
          <CardContent className="space-y-3 border-t border-border/50 pt-4">
              <>


                {!ownsFull && balance < unlockCost && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="flex-1">
                      <p className="font-semibold text-amber-100">
                        You need {unlockCost - balance} more coin
                        {unlockCost - balance === 1 ? "" : "s"} to unlock
                      </p>
                      <p className="text-xs text-amber-200/80">
                        Balance: {balance} · Cost: {unlockCost}
                      </p>
                    </div>
                    <Button asChild size="sm" className="shrink-0">
                      <Link to="/buy-coins">Top up</Link>
                    </Button>
                  </div>
                )}

                <Button
                  onClick={unlockFull}
                  disabled={!!(
                    unlocking ||
                    (ownsFull && (!isReady || !song.audio_path))
                  )}
                  variant={ownsFull ? "default" : "outline"}
                  className="h-12 w-full gap-2"
                  aria-live="polite"
                >
                  {unlocking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {ownsFull ? "Preparing download…" : "Processing payment…"}
                    </>
                  ) : ownsFull && (!isReady || !song.audio_path) ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Download pending — finishing track…
                    </>
                  ) : ownsFull ? (
                    <>
                      <Download className="h-4 w-4" /> Download to device
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" /> Unlock full track · {unlockCost} coins
                    </>
                  )}
                </Button>
              </>
          </CardContent>
          )}
        </Card>
        </TabsContent>

        <TabsContent value="takes" className="mt-0">
        {cooking ? (
          <p className="rounded-lg border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            Your old takes are hidden while OG Bot cooks the new version.
          </p>
        ) : (
          <VariationsCard variations={variations} />
        )}
        </TabsContent>
      </Tabs>

      <UnlockConfirmDialog
        open={unlockDialogOpen}
        onOpenChange={setUnlockDialogOpen}
        onConfirm={performUnlock}
        busy={unlocking}
        cost={unlockCost}
        royalty={0}
        balance={balance}
        songTitle={song.title ?? title}
        songId={song.id}
        includesSecondTake={isOwner}
      />

      <QuickTopUpSheet
        open={topUp !== null}
        onOpenChange={(v) => !v && setTopUp(null)}
        needed={topUp?.needed ?? 0}
        balance={balance}
        reason={topUp?.reason}
      />
    </div>
  );
}

/**
 * Lyrics skeleton — animated bars that mimic verse/chorus blocks so the
 * textarea area doesn't collapse while the model is writing.
 */
function LyricsSkeleton({ songId }: { songId?: string }) {
  const blocks = [
    { label: "[Verse 1]", lines: 6 },
    { label: "[Chorus]", lines: 4 },
    { label: "[Verse 2]", lines: 6 },
    { label: "[Bridge]", lines: 3 },
  ];
  const [progress, setProgress] = useState(4);
  const [stageLabel, setStageLabel] = useState("Reading your brief…");
  const startedAt = useRef<number>(Date.now());

  // Local easing tween so the bar moves smoothly between real backend events.
  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => (p >= 95 ? p : p + Math.max(0.2, (95 - p) * 0.015)));
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Realtime: snap to actual backend progress on every songs row update.
  useEffect(() => {
    if (!songId) return;
    const channel = supabase
      .channel(`lyrics-progress:${songId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "songs", filter: `id=eq.${songId}` },
        (payload) => {
          const row = payload.new as {
            lyrics_progress?: number | null;
            lyrics_stage?: string | null;
          };
          if (typeof row.lyrics_progress === "number")
            setProgress((p) => Math.max(p, row.lyrics_progress!));
          if (typeof row.lyrics_stage === "string" && row.lyrics_stage)
            setStageLabel(row.lyrics_stage);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [songId]);

  // ETA = linear extrapolation from elapsed wall-clock against real progress.
  const elapsedS = (Date.now() - startedAt.current) / 1000;
  const etaSeconds =
    progress > 5 && progress < 99
      ? Math.max(1, Math.round((elapsedS / progress) * (100 - progress)))
      : null;
  const etaLabel =
    etaSeconds == null
      ? "Almost there…"
      : etaSeconds >= 60
        ? `~${Math.floor(etaSeconds / 60)}m ${String(etaSeconds % 60).padStart(2, "0")}s left`
        : `~${etaSeconds}s left`;

  return (
    <div
      role="status"
      aria-label="Generating lyrics"
      aria-live="polite"
      className="space-y-4 rounded-md border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-4 font-mono text-sm"
    >
      <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
          <img
            src={ogBotAsset.url}
            alt=""
            className="relative h-12 w-12 rounded-full ring-2 ring-primary/60 shadow-[0_0_24px_-4px_hsl(var(--primary)/0.9)] animate-bounce"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-primary">OG Bot is cooking…</span>
            <span className="flex items-center gap-2 font-mono text-xs font-semibold tabular-nums text-primary">
              <span>{Math.round(progress)}%</span>
              <span className="rounded-full border border-primary/30 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {etaLabel}
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {stageLabel}
            <span className="inline-flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      </div>

      {blocks.map((b, bi) => (
        <div key={bi} className="space-y-1.5">
          <div className="text-[11px] font-semibold text-primary/80">{b.label}</div>
          {Array.from({ length: b.lines }).map((_, i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-muted/70"
              style={{
                width: `${55 + ((i * 13 + bi * 7) % 40)}%`,
                animationDelay: `${(bi * b.lines + i) * 80}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CostBadge({ cost }: { cost: number }) {
  return <CoinPill>{cost} coins</CoinPill>;
}

type GenerationStep = {
  label: string;
  detail: string;
  state: "done" | "active" | "waiting";
};

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function getGenerationStatus(
  elapsed: number,
  hasTaskId: boolean,
  hasLivePreview: boolean,
): {
  progress: number;
  etaSeconds: number;
  headline: string;
  detail: string;
  steps: GenerationStep[];
} {
  // Honest model: most jobs land in ~2 minutes, but the generator regularly
  // takes longer. We never promise a hard finish time — past the typical
  // window the UI stops counting down and says so plainly.
  const targetSeconds = hasLivePreview ? 120 : hasTaskId ? 150 : 45;
  const progress = !hasTaskId
    ? Math.min(15, 5 + Math.floor(elapsed * 0.25))
    : Math.min(90, Math.max(18, Math.round((elapsed / targetSeconds) * 80)));
  const etaSeconds = Math.max(0, targetSeconds - elapsed);

  if (!hasTaskId) {
    return {
      progress,
      etaSeconds,
      headline: "Starting the music job with the generator…",
      detail:
        elapsed > 45
          ? "Still waiting for the generator to accept the job — no fake progress here."
          : "Getting a real task ID before the mix begins. Typically 2-5 minutes in total.",
      steps: [
        { label: "Queued", detail: "Saving your prompt", state: "done" },
        { label: "Accepted", detail: "Waiting for task ID", state: "active" },
        { label: "Audio", detail: "Starts after acceptance", state: "waiting" },
      ],
    };
  }

  if (hasLivePreview) {
    return {
      progress: Math.max(progress, 68),
      etaSeconds,
      headline: "Live preview is ready — finishing the downloadable sample…",
      detail: "You can listen now. Packaging the final file usually takes another minute or two.",
      steps: [
        { label: "Queued", detail: "Task accepted", state: "done" },
        { label: "Preview", detail: "Streaming now", state: "done" },
        { label: "Sample", detail: "Packaging audio", state: "active" },
      ],
    };
  }

  return {
    progress,
    etaSeconds,
    headline:
      elapsed < 35
        ? "Composing melody and beat…"
        : elapsed < 90
          ? "Rendering vocals and mix…"
          : "Waiting for the generator to hand back the audio…",
    detail:
      elapsed > targetSeconds
        ? "Past the usual window — it can take a few more minutes. Nothing is stuck, and you keep your coins if it fails."
        : "Most tracks take 2-5 minutes. We only show real progress, never a fake countdown.",
    steps: [
      { label: "Queued", detail: "Task accepted", state: "done" },
      {
        label: "Audio",
        detail: elapsed < 75 ? "Generating track" : "Awaiting callback",
        state: "active",
      },
      { label: "Sample", detail: "Ready after callback", state: "waiting" },
    ],
  };
}

/**
 * Professional "generating" progress block — elapsed timer, animated waveform
 * skeleton, and rotating status copy so the wait feels intentional rather than
 * dead. Suno typically takes 30–90s; we model that with a soft progress curve
 * that asymptotes near the expected window.
 */
function GeneratingProgress({
  sampleSeconds,
  startedAt,
  taskId,
  hasLivePreview = false,
  songId,
  onCancelled,
}: {
  sampleSeconds: number;
  startedAt?: string | null;
  taskId?: string | null;
  hasLivePreview?: boolean;
  songId?: string;
  onCancelled?: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  async function handleCancel() {
    if (!songId || cancelling) return;
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke("suno-cancel", {
        body: { song_id: songId },
      });
      if (error) {
        toast.error(await readInvokeError(error, "Could not cancel"));
        return;
      }
      const refunded = Number((data as { refunded?: number } | null)?.refunded ?? 0);
      toast.success(
        refunded > 0
          ? `Generation cancelled — ${refunded} coins refunded`
          : "Generation cancelled",
      );
      onCancelled?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  }
  // Anchor elapsed to the DB-side start time (song.updated_at when status flipped to
  // pending) so a hard refresh continues the timer mid-flight instead of restarting at 0.
  const startMs = useMemo(() => {
    if (startedAt) {
      const t = Date.parse(startedAt);
      if (!Number.isNaN(t)) return t;
    }
    return Date.now();
  }, [startedAt]);

  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startMs) / 1000)),
  );
  useEffect(() => {
    setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000))),
      250,
    );
    return () => clearInterval(id);
  }, [startMs]);

  const status = getGenerationStatus(elapsed, !!taskId, hasLivePreview);
  const pct = status.progress;
  // Once the typical window has passed we stop pretending to know a finish
  // time — the label switches to a plain "still rendering" state.
  const etaLabel =
    status.etaSeconds > 0 ? `~${formatDuration(status.etaSeconds)}` : "still rendering";

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div
      role="status"
      aria-live="polite"
      className="generating-aura relative space-y-4 overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-card to-card p-5 shadow-[0_20px_60px_-15px_hsl(var(--primary)/0.5)]"
    >
      {/* Ambient red/blue glow blobs behind content */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-10 -z-10 opacity-80"
        style={{
          background:
            "radial-gradient(40% 50% at 15% 30%, rgba(239,68,68,0.35), transparent 70%), radial-gradient(45% 55% at 85% 70%, rgba(59,130,246,0.45), transparent 70%)",
          filter: "blur(24px)",
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
            <img
              src={ogBotAsset.url}
              alt=""
              className="relative h-12 w-12 rounded-full ring-2 ring-primary/60 shadow-[0_0_24px_-4px_hsl(var(--primary)/0.9)] animate-bounce"
            />
          </span>

          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold tracking-tight text-foreground">
              Cooking your {sampleSeconds}s preview
            </p>
            <p className="truncate text-xs text-muted-foreground">{status.headline}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-full border border-primary/40 bg-background/70 px-3 py-1.5 text-right text-xs font-bold text-foreground shadow-[0_0_18px_-4px_hsl(var(--primary)/0.7)]">
            <span className="block tabular-nums">
              {status.etaSeconds > 0 ? `ETA ${etaLabel}` : etaLabel}
            </span>
            <span className="block text-[10px] font-medium text-muted-foreground tabular-nums">
              {mm}:{ss} elapsed
            </span>
          </div>
          {songId && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="h-9 rounded-full px-3"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Stop"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        {status.steps.map((step) => (
          <div
            key={step.label}
            className={cn(
              "rounded-lg border px-3 py-2",
              step.state === "done" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
              step.state === "active" &&
                "border-primary/40 bg-primary/10 text-foreground shadow-[0_0_16px_-8px_hsl(var(--primary)/0.8)]",
              step.state === "waiting" && "border-border bg-background/30",
            )}
          >
            <div className="flex items-center gap-2 font-semibold">
              {step.state === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : step.state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-current opacity-50" />
              )}
              {step.label}
            </div>
            <p className="mt-1 text-[11px] opacity-80">{step.detail}</p>
          </div>
        ))}
      </div>

      {/* Animated waveform skeleton with the live percentage front and centre */}
      <div className="relative h-24 overflow-hidden rounded-xl border border-primary/25 bg-background/30 p-2 sm:h-28">
        <div className="flex h-full items-end gap-1 opacity-60" aria-hidden="true">
          {Array.from({ length: 28 }).map((_, i) => (
            <span
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-primary/50 to-primary shadow-[0_0_8px_hsl(var(--primary)/0.55)]"
              style={{
                height: `${30 + Math.abs(Math.sin((i + elapsed) * 0.6)) * 70}%`,
                opacity: 0.45 + (i % 4) * 0.15,
                transition: "height 320ms ease-in-out",
              }}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-2xl bg-background/55 px-4 py-1.5 text-center backdrop-blur-sm">
            <span className="block text-4xl font-black leading-none tabular-nums text-white drop-shadow-[0_0_18px_hsl(var(--primary))] sm:text-5xl">
              {pct}%
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/90">
              {status.etaSeconds > 0 ? `ETA ${etaLabel}` : etaLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar — thicker, glowing, with moving shimmer */}
      <div className="space-y-1.5">
        <div className="relative h-3 overflow-hidden rounded-full bg-muted/60 ring-1 ring-primary/20">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#ef4444] via-primary to-[#3b82f6] shadow-[0_0_16px_hsl(var(--primary)/0.9),0_0_4px_hsl(var(--primary))] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
          {/* Shimmer sheen */}
          <span
            aria-hidden="true"
            className="generating-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>{status.detail}</span>
          <span className="tabular-nums text-foreground/90">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline mini-player shown directly under the "Generate preview" button so
 * the user can hear the freshly generated sample without scrolling up.
 * Auto-loads the signed preview URL when the song becomes ready.
 */
function InlineSamplePlayer({ songId, unlocked = false }: { songId: string; unlocked?: boolean }) {
  const { data: settings } = useSettings();
  const sampleSeconds = settings?.sample_seconds ?? 60;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paid tracks fall back to the sample only if the full file isn't ready yet.
  const { isBoss } = useRole();
  const canPlayFull = unlocked || isBoss;
  const [playingFull, setPlayingFull] = useState(canPlayFull);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // When a sample flips to the full track, remember where the listener was so
  // the full version carries on from that exact spot.
  const resumeAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const prev = audioRef.current;
    if (canPlayFull && prev && prev.currentTime > 0) {
      resumeAtRef.current = prev.currentTime;
    }
    setError(null);
    setUrl(null);
    setLoading(true);
    (async () => {
      try {
        if (canPlayFull) {
          const full = await supabase.functions.invoke("song-url", {
            body: { song_id: songId, mode: "full", purpose: "stream" },
          });
          if (cancelled) return;
          if (!full.error && full.data?.url) {
            setPlayingFull(true);
            setUrl(full.data.url as string);
            return;
          }
        }
        setPlayingFull(false);
        const { data, error } = await supabase.functions.invoke("song-url", {
          body: { song_id: songId, mode: "preview" },
        });
        if (cancelled) return;
        if (error || !data?.url) {
          setError(await readInvokeError(error, "Could not load preview"));
        } else {
          setUrl(data.url as string);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songId, canPlayFull]);

  // Cap playback at the sample length — unless the track has been paid for.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || playingFull) return;
    const onTime = () => {
      if (el.currentTime >= sampleSeconds) {
        el.pause();
        el.currentTime = sampleSeconds;
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [sampleSeconds, url, playingFull]);

  return (
    <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
        <Check className="h-4 w-4" />
        {playingFull ? "Unlocked · full track" : `Preview ready · ${sampleSeconds}s sample`}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sample…
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {url && (
        <audio
          ref={audioRef}
          src={url}
          controls
          preload="auto"
          onLoadedMetadata={(e) => {
            const at = resumeAtRef.current;
            if (at == null || !playingFull) return;
            resumeAtRef.current = null;
            const el = e.currentTarget;
            el.currentTime = at;
            void el.play().catch(() => {});
          }}
          className="w-full rounded-lg bg-black/30"
          aria-label="Sample preview"
        />
      )}
    </div>
  );
}

/**
 * Suno-style live stream preview. Plays the in-progress generation directly
 * from Suno's stream URL while the full sample keeps cooking in the background.
 * Hard-cuts at `limitSeconds` (default 35s) and shows a "keep cooking" blocker
 * so users get instant feedback without being able to scrub past the preview.
 */
function LiveStreamPreview({
  streamUrl,
  limitSeconds = 35,
}: {
  streamUrl: string;
  limitSeconds?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [played, setPlayed] = useState(0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setPlayed(el.currentTime);
      if (el.currentTime >= limitSeconds) {
        el.pause();
        el.currentTime = limitSeconds;
        setBlocked(true);
      }
    };
    const onSeeking = () => {
      if (el.currentTime > limitSeconds) {
        el.currentTime = limitSeconds;
        setBlocked(true);
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeking", onSeeking);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeking", onSeeking);
    };
  }, [limitSeconds, streamUrl]);

  const pct = Math.min(100, (played / limitSeconds) * 100);
  const remaining = Math.max(0, Math.ceil(limitSeconds - played));

  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 via-card to-card p-3 shadow-[0_0_24px_-8px_hsl(var(--primary)/0.6)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Live preview · listen while it generates
        </div>
        <span className="rounded-full border border-primary/40 bg-background/60 px-2 py-0.5 text-[10px] font-bold tabular-nums text-foreground">
          {blocked ? "Locked" : `${remaining}s left`}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={streamUrl}
        controls
        autoPlay
        preload="auto"
        className="w-full rounded-lg bg-black/30"
        aria-label="Live streaming preview"
      />

      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#ef4444] via-primary to-[#3b82f6] transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>

      {blocked && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />
          <div>
            <p className="font-semibold">First {limitSeconds}s preview ended</p>
            <p className="text-amber-200/80">
              The full preview is still cooking — it'll unlock automatically as soon as it's ready.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
