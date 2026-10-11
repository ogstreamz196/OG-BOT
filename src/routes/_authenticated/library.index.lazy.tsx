import { runQueuedSong } from "@/lib/song-queue.functions";
import { startAttempt, updateAttempt, describeError } from "@/lib/generation-attempts";
import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const WIZARD_DRAFT_KEY = "ogbot.wizardDraft.v1";
import { useSessionRunState } from "@/hooks/use-session-run-state";

/** Falling ember config for the hazard CREATE button — staggered so the shower looks random. */
const SPARKS = [
  { left: "22%", delay: "0s", dur: "1.7s", drift: "-14px" },
  { left: "38%", delay: "0.6s", dur: "2.1s", drift: "10px" },
  { left: "52%", delay: "1.2s", dur: "1.5s", drift: "-6px" },
  { left: "66%", delay: "0.3s", dur: "2.4s", drift: "16px" },
  { left: "78%", delay: "1.8s", dur: "1.9s", drift: "-10px" },
  { left: "30%", delay: "2.2s", dur: "2.2s", drift: "8px" },
];

import {
  Loader2,
  Library as LibraryIcon,
  Sparkles,
  RefreshCw,
  Wand2,
  Coins,
  Mic2,
  Music4,
  Shuffle,
  Search,
  Users,
  Crown,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  improveLyricDescription,
  listSongBriefDrafts,
  deleteSongBriefDraft,
  updateSongBriefDraft,
} from "@/lib/improve-description.functions";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import { useRole } from "@/hooks/use-role";
import { useProfile } from "@/hooks/use-profile";
import { useSettings } from "@/hooks/use-settings";
import { invokeError } from "@/lib/invoke-error";
import { cn } from "@/lib/utils";
import { SongCard, type Song } from "@/components/SongCard";
import { SongCardSkeleton } from "@/components/library/SongCardSkeleton";
import {
  META,
  PERSONAL_DETAILS_MAX,
  POOLS,
  SURPRISE_TEMPLATES,
  SURPRISE_TITLES,
  initialChips,
  personalDetailsCheck,
  pickFresh,
  randomPick,
  type Category,
  type Selections,
} from "@/lib/library-utils";

import { Skeleton } from "@/components/ui/skeleton";
import { Disc3, Flame } from "lucide-react";

import { PoweredByOgBot } from "@/components/PoweredByOgBot";
import { JobQueuePanel } from "@/components/library/JobQueuePanel";
import { CategoryCard } from "@/components/library/CategoryCard";
import { StyleComposer } from "@/components/library/StyleComposer";
import { CollapsibleStep } from "@/components/library/CollapsibleStep";
import {
  CreateNowWizard,
  EMPTY_DRAFT,
  GUEST_PENDING_SONG_KEY,
  type WizardDraft,
  type WizardResult,
} from "@/components/library/CreateNowWizard";
import { CommunityTrackRow } from "@/components/library/CommunityTrackRow";
import { MiniPlayer } from "@/components/library/MiniPlayer";
import { LibraryFilters, type LibraryFilterMode } from "@/components/library/LibraryFilters";
import { PlaylistProvider, PlaylistOrder, usePlaylist } from "@/hooks/use-playlist";
import { peekFullTrackPlay, clearFullTrackPlay } from "@/lib/full-track-autoplay";
import { useFoulIntensity, useFoulMouth, useSetFoulMouth } from "@/hooks/use-foul-mouth";

import { FreshTrackCard } from "@/components/library/FreshTrackCard";
import { MasterpieceDialog } from "@/components/library/MasterpieceDialog";
import { StudioMeter, StudioLed } from "@/components/library/StudioConsole";
import { CookingDialog } from "@/components/library/CookingDialog";
import { BeatLibrary, type SavedBeat } from "@/components/library/BeatLibrary";
import { ReviewDialog } from "@/components/library/ReviewDialog";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const MIN_TRACK_MINUTES = 3;

export const Route = createLazyFileRoute("/_authenticated/library/")({
  component: LibraryRoute,
});

/** Playlist context wraps the page so rows and the media bar share one queue. */
function LibraryRoute() {
  return (
    <PlaylistProvider>
      <LibraryPage />
    </PlaylistProvider>
  );
}

function LibraryPage() {
  const playlist = usePlaylist();
  const { user } = useAuth();
  const dev = useDevMode();
  const { isAdmin, isBoss } = useRole();
  const { data: profile, refetch: refetchProfile } = useProfile();
  const { data: settings } = useSettings();
  const navigate = useNavigate();

  const lyricsCost = settings?.coins_per_lyrics_generation ?? 0;
  const previewCost = settings?.coins_per_generation ?? 0;
  const unlockCost = settings?.coins_per_full_unlock ?? 5;
  const sampleSeconds = settings?.sample_seconds ?? 60;
  /** Set from the toast CTA so the finished-track card opens its unlock sheet. */
  const [autoUnlockPrompt, setAutoUnlockPrompt] = useState(false);
  // download cost is configured via settings.coins_per_full_unlock when needed
  const balance = profile?.coin_balance ?? 0;


  const firstName = useMemo(() => {
    if (dev.isDev) return "Developer";
    const raw = profile?.display_name?.trim() || user?.email?.split("@")[0] || "";
    return raw.split(/\s|\./)[0] || "there";
  }, [profile?.display_name, user?.email, dev.isDev]);

  const [wizardOpen, setWizardOpen] = useState(false);
  // "It's cooking" popup shown right after the wizard is submitted.
  const [cooking, setCooking] = useState<{ open: boolean; title: string }>({
    open: false,
    title: "",
  });
  // Last raw wizard answers — kept so a retry (or reopening the wizard after a
  // failure) never loses what the user already typed.
  const [wizardDraft, setWizardDraftState] = useState<WizardDraft>(EMPTY_DRAFT);
  // Saved on this device the moment Create is pressed, so a lost connection
  // or failed attempt never makes the user retype their story.
  const setWizardDraft = useCallback((d: WizardDraft) => {
    setWizardDraftState(d);
    try {
      window.localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WIZARD_DRAFT_KEY);
      if (raw) {
        setWizardDraftState({ ...EMPTY_DRAFT, ...JSON.parse(raw) });
        return;
      }
    } catch {
      /* ignore corrupt draft */
    }
    // New device or cleared storage: recover the answers saved with the
    // user's latest failed attempt in the backend.
    if (!user?.id) return;
    void (async () => {
      const { data } = await supabase
        .from("generation_attempts" as never)
        .select("status, context")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = data as { status?: string; context?: { draft?: WizardDraft } } | null;
      if (row?.status !== "succeeded" && row?.context?.draft) {
        setWizardDraftState({ ...EMPTY_DRAFT, ...row.context.draft });
      }
    })();
  }, [user?.id]);

  // Home "Create now" thumbnail lands here with #create — open the wizard.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#create") return;
    setWizardOpen(true);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  /**
   * "Use this vibe" — open the wizard pre-loaded with a track's styles and
   * languages so a new song only needs a name and a story.
   */
  const remixFromSong = useCallback((s: { style?: string | null }) => {
    const parts = (s.style || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const match = (pool: string[]) =>
      pool.filter((v) => parts.some((p) => p.toLowerCase() === v.toLowerCase()));
    const styles = match(POOLS.genre);
    const languages = match(POOLS.language);
    setWizardDraft({
      ...EMPTY_DRAFT,
      styles,
      languages,
    });
    setWizardOpen(true);
    toast.success(
      styles.length
        ? `Vibe loaded: ${styles.join(", ")}. Add who it's about.`
        : "Vibe loaded — pick your styles and go.",
    );
  }, []);

  const statusPanelRef = useRef<HTMLElement | null>(null);
  const libraryRef = useRef<HTMLElement | null>(null);
  // Track length is chosen in step 1 of the Create now wizard (3 min floor).
  const [targetMinutes, setTargetMinutes] = useState(MIN_TRACK_MINUTES);
  const targetDurationSec = Math.max(MIN_TRACK_MINUTES, targetMinutes) * 60;
  /** Creating, writing and rendering are free; payment starts at the final download. */
  const audioCost = 0;
  // Actual estimate returned by the lyrics engine once a track is generated.
  const [actualDurationLabel, setActualDurationLabel] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [subjectName, setSubjectName] = useState("");
  // Defaults: English locked as the default language. Genre/mood/theme are now
  // composed via the single StyleComposer field below (styleText).
  const [selections, setSelections] = useState<Selections>(() => ({
    language: "English",
  }));
  const [chips, setChips] = useState<Record<Category, string[]>>(() => initialChips());
  const [styleText, setStyleText] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [genLyrics, setGenLyrics] = useState(false);
  const { foulMouth } = useFoulMouth();
  const { intensity: foulIntensity } = useFoulIntensity();
  const setFoulMouthMutation = useSetFoulMouth();
  const setFoulMouth = (updater: boolean | ((v: boolean) => boolean)) => {
    const next = typeof updater === "function" ? updater(foulMouth) : updater;
    setFoulMouthMutation.mutate(next);
  };
  const foulMouthSaving = setFoulMouthMutation.isPending;

  const [personalDetails, setPersonalDetails] = useState("");
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const improveDescription = useServerFn(improveLyricDescription);
  const listDrafts = useServerFn(listSongBriefDrafts);
  const deleteDraft = useServerFn(deleteSongBriefDraft);
  const updateDraft = useServerFn(updateSongBriefDraft);
  const draftsQuery = useInfiniteQuery({
    queryKey: ["song-brief-drafts"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listDrafts({ data: { offset: pageParam } }),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
    staleTime: 30_000,
  });
  const allDrafts = useMemo(
    () => draftsQuery.data?.pages.flatMap((p) => p.drafts) ?? [],
    [draftsQuery.data],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Build one consistent brief that fills BOTH the style prompt and the lyrics
  // description in the same shape every time Improve succeeds.
  const buildBrief = (improved: string) => {
    const clean = improved.replace(/\s+/g, " ").trim();
    const style = `Style: ${clean}`.slice(0, 400);
    const lyrics = `Style: ${clean}\nLyrics brief: ${clean}`.slice(0, 1000);
    return { style, lyrics, clean };
  };
  const applyDraft = (d: { improved_text: string; subject_name: string | null }) => {
    const { style, lyrics, clean } = buildBrief(d.improved_text);
    setPersonalDetails(clean.slice(0, PERSONAL_DETAILS_MAX));
    setExtraContext(lyrics);
    setStyleText(style);
    if (d.subject_name && !subjectName.trim()) setSubjectName(d.subject_name.slice(0, 60));
    toast.success("Loaded saved brief — style & lyrics filled in");
  };
  const removeDraft = async (id: string) => {
    try {
      await deleteDraft({ data: { id } });
      await draftsQuery.refetch();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't delete");
    }
  };
  const startEdit = (d: { id: string; improved_text: string }) => {
    setEditingId(d.id);
    setEditingText(d.improved_text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };
  const saveEdit = async () => {
    if (!editingId) return;
    const next = editingText.trim();
    if (!next) {
      toast.info("Brief can't be empty");
      return;
    }
    setSavingEdit(true);
    try {
      await updateDraft({ data: { id: editingId, improvedText: next } });
      await draftsQuery.refetch();
      toast.success("Brief updated");
      cancelEdit();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save");
    } finally {
      setSavingEdit(false);
    }
  };
  const handleImproveDescription = async () => {
    const text = personalDetails.trim();
    if (!text || improving) return;
    if (text.length < 8) {
      toast.info("Write a few words first, then tap Improve.");
      return;
    }
    setImproving(true);
    setImproveError(null);
    try {
      const { improved } = await improveDescription({
        data: { text, subjectName: subjectName.trim() || undefined },
      });
      const { style, lyrics, clean } = buildBrief(improved);
      setPersonalDetails(clean.slice(0, PERSONAL_DETAILS_MAX));
      setExtraContext(lyrics);
      setStyleText(style);
      toast.success("Polished ✨ — style & lyrics prompt filled in");
      draftsQuery.refetch();
    } catch (err) {
      setImproveError((err as Error).message || "Couldn't improve just now");
    } finally {
      setImproving(false);
    }
  };
  const [extraContext, setExtraContext] = useState("");
  const [genSong, setGenSong] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Song | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [yoursSearch, setYoursSearch] = useState("");
  const [communitySearch, setCommunitySearch] = useState("");
  const [yoursFilter, setYoursFilter] = useState<LibraryFilterMode>("all");
  const [communityFilter, setCommunityFilter] = useState<LibraryFilterMode>("unlocked");
  const [yoursStyle, setYoursStyle] = useState<string | null>(null);
  const [communityStyle, setCommunityStyle] = useState<string | null>(null);

  // Build a human-readable line from language + freeform style text.
  const selectionsLine = useMemo(() => {
    const parts: string[] = [];
    if (selections.language) parts.push(`Language: ${selections.language}`);
    if (styleText.trim()) parts.push(`Style: ${styleText.trim()}`);
    return parts.join(" · ");
  }, [selections.language, styleText]);

  // Sync the auto-built line into the lyric description box. Preserve any
  // free-text the user added below the auto-line on their own.
  useEffect(() => {
    setExtraContext((prev) => {
      const marker = "—".repeat(3);
      const split = prev.split(`\n${marker}\n`);
      const userTail = split.length > 1 ? split.slice(1).join(`\n${marker}\n`) : "";
      if (!selectionsLine && !userTail) return "";
      if (!selectionsLine) return userTail;
      return userTail ? `${selectionsLine}\n${marker}\n${userTail}` : selectionsLine;
    });
  }, [selectionsLine]);

  function setField(cat: Category, value: string) {
    setSelections((prev) => ({ ...prev, [cat]: value }));
  }

  function refreshRow(cat: Category) {
    const exclude = new Set<string>([selections[cat] ?? ""].filter(Boolean));
    setChips((prev) => ({ ...prev, [cat]: pickFresh(cat, exclude, 4, selections) }));
  }

  function pickChip(cat: Category, value: string) {
    setField(cat, value);
    setChips((prev) => {
      const ctx: Selections = { ...selections, [cat]: value };
      const used = new Set<string>([...prev[cat], value].filter(Boolean));
      const replacement = pickFresh(cat, used, 1, ctx)[0];
      return {
        ...prev,
        [cat]: prev[cat].map((c) => (c === value ? (replacement ?? c) : c)),
      };
    });
  }

  // Style tags fed to the AI = the tokens the user assembled in the composer.
  const styleTags = useMemo(
    () =>
      styleText
        .split(/[·,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
    [styleText],
  );

  const hasStyle = styleText.trim().length > 0;

  const totalFilled =
    (title.trim() ? 1 : 0) +
    (subjectName.trim() ? 1 : 0) +
    (personalDetails.trim().length >= 20 ? 1 : 0) +
    (selections.language ? 1 : 0) +
    (hasStyle ? 1 : 0);
  const progress = Math.min(100, Math.round((totalFilled / 5) * 100));

  const canGenerateLyrics =
    !!title.trim() &&
    !!subjectName.trim() &&
    !!selections.language &&
    hasStyle &&
    balance >= lyricsCost;

  async function generateLyrics() {
    if (!canGenerateLyrics) return;
    setGenLyrics(true);
    try {
      const description = styleText.trim();
      const combinedExtra = extraContext.trim();

      const { data, error } = await supabase.functions.invoke("generate-lyrics", {
        body: {
          songName: title.trim(),
          description,
          styleTags,
          language: selections.language,
          vocal: "Mix voice",
          targetDurationSec,
          foulMouth,
          foulIntensity,
          personalDetails: personalDetails.trim() || undefined,
          extraContext: combinedExtra || undefined,
          subjectName: subjectName.trim() || undefined,
        },
      });
      if (error) {
        const msg = invokeError(error, "Lyrics generation failed");
        toast.error(
          msg.toLowerCase().includes("insufficient")
            ? `Not enough coins (need ${lyricsCost})`
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
      toast.success("Lyrics ready · free");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lyrics generation failed");
    } finally {
      setGenLyrics(false);
    }
  }

  const generateLockRef = useRef(false);
  async function generateSong() {
    if (generateLockRef.current) return;
    if (!user) return;
    if (!lyrics.trim()) {
      toast.error("Generate lyrics first");
      return;
    }
    if (balance < audioCost) {
      toast.error(`Need ${audioCost} coins to generate a song`);
      return;
    }
    generateLockRef.current = true;
    setGenSong(true);
    try {
      // Backend enforces global + per-user concurrency limits (returns 429 when over capacity).
      const style = styleText.trim();
      const promptText = [
        title.trim(),
        subjectName.trim() ? `For: ${subjectName.trim()}` : null,
        style ? `Style: ${style}` : null,
        selections.language ? `Language: ${selections.language}` : null,
      ]
        .filter(Boolean)
        .join(" — ");

      const { data: row, error: insertErr } = await supabase
        .from("songs")
        .insert({
          user_id: user.id,
          title: title.trim() || null,
          prompt:
            (promptText || title.trim() || "Untitled") +
            (personalDetails.trim() ? `\n— Idea: ${personalDetails.trim()}` : ""),
          style: style || null,
          lyrics,
          status: "draft",
          extra_context: extraContext.trim() || null,
        } as never)
        .select("id")
        .single();

      if (insertErr || !row?.id) {
        toast.error(insertErr?.message || "Couldn't save song");
        return;
      }

      const { data: genData, error: genErr } = await supabase.functions.invoke("suno-generate", {
        body: {
          song_id: row.id,
          prompt: promptText,
          lyrics,
          title: title.trim() || null,
          style: style || null,
          language: selections.language || null,
          vocal: "Mix voice",
          target_duration_sec: targetDurationSec,
        },
      });
      if (genErr) {
        toast.error(invokeError(genErr, "Could not start generation"));
        return;
      }
      if (genData?.accepted === false) {
        toast.info(genData.error || "Your current generations need to finish first");
        return;
      }
      toast.success("OG Bot is creating your song — no credits charged");
      navigate({ to: "/library/$songId", params: { songId: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate song");
    } finally {
      setGenSong(false);
      generateLockRef.current = false;
    }
  }

  /* ------------------------------------------------------------------
   * One-tap pipeline: lyrics → save → kick off Suno preview → navigate.
   * The user sees a single progress bar with a live ETA while everything
   * happens in the backend, then lands on the song page for the sample.
   * ------------------------------------------------------------------ */
  type PipelineStage = "idle" | "lyrics" | "saving" | "submitting" | "rendering" | "error";
  const PIPELINE_ORDER: PipelineStage[] = ["lyrics", "saving", "submitting", "rendering"];
  // Baseline per-stage ETAs (ms) — recalibrated live from real timings below.
  const BASE_STAGE_ETA: Record<Exclude<PipelineStage, "idle" | "error">, number> = {
    lyrics: 18_000,
    saving: 1_500,
    submitting: 4_500,
    // Real-world Suno renders run 2-5 minutes; keep the estimate honest.
    rendering: 150_000,
  };

  type PipelineState = {
    stage: PipelineStage;
    startedAt: number;
    stageStartedAt: number;
    durations: Partial<Record<PipelineStage, number>>;
    error?: string;
  };
  // App-lifetime: an in-flight creation keeps running and is shown again
  // when the user navigates away and comes back.
  const [pipeline, setPipeline] = useSessionRunState<PipelineState>("pipeline", {
    stage: "idle",
    startedAt: 0,
    stageStartedAt: 0,
    durations: {},
  });
  const [pipelineNow, setPipelineNow] = useState(0);
  // Lyrics are written and the track saved from this page, so warn before
  // closing during those first seconds or the track would be lost.
  useEffect(() => {
    // The server queue now owns the job, so leaving the page is always safe.
    return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pipeline.stage]);
  const pipelineLockRef = useRef(false);
  // The song we're watching in realtime while its audio renders.
  const [trackedSongId, setTrackedSongId] = useSessionRunState<string | null>(
    "trackedSongId",
    null,
    true,
  );

  const [freshTrack, setFreshTrack] = useState<Song | null>(null);
  // Finished-track player popup: takes over from the wizard/cooking popup.
  const [masterpieceOpen, setMasterpieceOpen] = useState(false);
  const masterpieceShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!freshTrack) return;
    if (masterpieceShownRef.current === freshTrack.id) return;
    masterpieceShownRef.current = freshTrack.id;
    setCooking((c) => ({ ...c, open: false }));
    setWizardOpen(false);
    setMasterpieceOpen(true);
  }, [freshTrack]);

  const totalCost = lyricsCost + audioCost;
  const canRunPipeline =
    !!user && canGenerateLyrics && balance >= totalCost && pipeline.stage === "idle";

  useEffect(() => {
    if (pipeline.stage === "idle" || pipeline.stage === "error") return;
    setPipelineNow(Date.now());
    const id = window.setInterval(() => setPipelineNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pipeline.stage, pipeline.stageStartedAt]);

  const pipelineStageRef = useRef<PipelineStage>("idle");
  pipelineStageRef.current = pipeline.stage;
  const advanceStage = (next: PipelineStage) => {
    setPipeline((p) => {
      const now = Date.now();
      const prev = p.stage;
      const durations = { ...p.durations };
      if (prev !== "idle" && prev !== "error") {
        durations[prev] = now - p.stageStartedAt;
      }
      return { ...p, stage: next, stageStartedAt: now, durations };
    });
  };

  const pipelineRunRef = useRef(0);

  function resetPipeline() {
    setPipeline({ stage: "idle", startedAt: 0, stageStartedAt: 0, durations: {} });
    setPipelineNow(0);
  }

  /** Cancel an in-progress generation and clear the realtime status UI. */
  function cancelGeneration() {
    pipelineRunRef.current += 1;
    pipelineLockRef.current = false;
    setTrackedSongId(null);
    resetPipeline();
    toast.info("Generation cancelled — the status panel is cleared");
  }

  /* Watchdog: if a stage hangs (provider outage, lost callback) we surface a
   * clear timeout error instead of spinning forever. Inputs stay in state so
   * the retry button can re-run the exact same request. */
  // Long / a cappella tracks legitimately take minutes to write and render, so
  // these are generous — a premature timeout charged the coins and lost the run.
  const STAGE_TIMEOUT_MS: Record<string, number> = {
    lyrics: 420_000,
    saving: 60_000,
    submitting: 120_000,
    rendering: 900_000,
  };
  useEffect(() => {
    const limit = STAGE_TIMEOUT_MS[pipeline.stage];
    if (!limit) return;
    const id = window.setTimeout(() => {
      pipelineRunRef.current += 1;
      pipelineLockRef.current = false;
      setTrackedSongId(null);
      const which = pipeline.stage === "lyrics" ? "Lyrics generation" : "The studio";
      setPipeline((p) => ({
        ...p,
        stage: "error",
        error: `${which} timed out. Nothing was lost — your details are saved, tap Try again.`,
      }));
      toast.error("Timed out — tap Try again, your details are saved");
    }, limit);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.stage, pipeline.stageStartedAt]);

  type CreateOverrides = {
    title: string;
    subjectName: string;
    description: string;
    style: string;
    language: string;
    /** Artist voice from the wizard — drives Suno's vocalGender + style tags. */
    vocal?: string;
    /** Vocals-only mode — a cappella / sing over an uploaded beat. */
    vocalsOnly?: boolean;
    /** Storage path of the uploaded beat, when one was provided. */
    beatPath?: string;
    /** Requested track length in minutes, chosen in wizard step 1. */
    targetMinutes?: number;
    /** Publish directly to the global player instead of keeping it private. */
    isPublic?: boolean;
    /** Exact lyric rating captured when this track was submitted. */
    foulMouth?: boolean;
    foulIntensity?: number;
    /** AI title resolving in the background; awaited only before saving. */
    titlePromise?: Promise<string>;
  };

  // Keeps the exact payload of the last run so "Try again" reuses it verbatim.
  const [lastOverrides, setLastOverrides] = useState<CreateOverrides | null>(null);

  async function createSong(override?: CreateOverrides) {
    if (pipelineLockRef.current) return;
    if (!user) return;
    if (override) {
      if (balance < totalCost) {
        toast.error(`Need ${totalCost} coins to create a song`);
        return;
      }
      setLastOverrides(override);
    } else if (!canRunPipeline) {
      return;
    }

    let songTitle = (override?.title ?? title).trim();
    const songSubject = (override?.subjectName ?? subjectName).trim();
    const songStyle = (override?.style ?? styleText).trim();
    const songLanguage = (override?.language ?? selections.language ?? "English").trim();
    const songDetails = (override?.description ?? personalDetails).trim();
    const songVocal = (override?.vocal || "Mix voice").trim();
    const vocalsOnly = !!override?.vocalsOnly;
    const beatPath = (override?.beatPath ?? "").trim();
    const trackFoulIntensity = Math.max(
      0,
      Math.min(3, Math.round(override?.foulIntensity ?? foulIntensity)),
    );
    const trackFoulMouth = (override?.foulMouth ?? foulMouth) && trackFoulIntensity > 0;
    const overrideTargetSec =
      Math.max(MIN_TRACK_MINUTES, override?.targetMinutes ?? targetMinutes) * 60;
    // Vocals-only: either the user's own beat carries the music, or we fall
    // back to a pure a cappella with humming and zero instrumentation.
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

    // Each style is its own tag (the wizard returns them comma-separated), and
    // the chosen voice rides along so the lyrics engine writes for it too.
    const songStyleTags = (
      override
        ? override.style
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : styleTags
    ).concat(vocalsOnlyTags);
    pipelineLockRef.current = true;
    const runId = ++pipelineRunRef.current;
    const stale = () => pipelineRunRef.current !== runId;
    const startedAt = Date.now();
    setPipeline({ stage: "lyrics", startedAt, stageStartedAt: startedAt, durations: {} });
    setPipelineNow(startedAt);

    // Stage the job in the database before any provider call so a failure
    // anywhere below always leaves a traceable record.
    let attemptStage = "lyrics";
    let attemptSongId: string | null = null;
    let savedDraft: WizardDraft | null = null;
    try {
      const raw = window.localStorage.getItem(WIZARD_DRAFT_KEY);
      savedDraft = raw ? (JSON.parse(raw) as WizardDraft) : null;
    } catch {
      savedDraft = null;
    }
    const attemptId = await startAttempt(user.id, {
      title: songTitle || null,
      stage: attemptStage,
      context: {
        language: songLanguage,
        style: songStyle,
        vocal: songVocal,
        vocals_only: vocalsOnly,
        has_beat: !!beatPath,
        target_sec: overrideTargetSec,
        foul_intensity: trackFoulIntensity,
        // The user's raw wizard answers, so any retry or device can restore them.
        draft: savedDraft,
      },
    });

    try {
      const description = songStyle;
      const combinedExtra = extraContext.trim();
      const lyricBody = {
        songName: songTitle,
        description,
        styleTags: songStyleTags,
        language: songLanguage,
        vocal: songVocal,
        foulMouth: trackFoulMouth,
        foulIntensity: trackFoulIntensity,
        personalDetails: songDetails || undefined,
        extraContext: combinedExtra || undefined,
        subjectName: songSubject || undefined,
        targetDurationSec: overrideTargetSec,
        vocalsOnly,
      };
      // Save the job on the server first: if this phone sleeps or loses signal,
      // the background worker finishes the song from these exact answers.
      const earlyStyle = [songStyle, songVocal, ...vocalsOnlyTags].filter(Boolean).join(", ");
      const earlyPrompt =
        ([songTitle, songSubject ? `For: ${songSubject}` : null, earlyStyle ? `Style: ${earlyStyle}` : null, songLanguage ? `Language: ${songLanguage}` : null]
          .filter(Boolean)
          .join(" — ") || songTitle || "Untitled") + (songDetails ? `\n— Idea: ${songDetails}` : "");
      const sunoBase = {
        prompt: earlyPrompt,
        title: songTitle || null,
        style: songStyle || null,
        language: songLanguage || null,
        vocal: songVocal || null,
        vocals_only: vocalsOnly,
        beat_path: beatPath || null,
        target_duration_sec: overrideTargetSec,
      };
      const { data: staged, error: stageErr } = await supabase
        .from("songs")
        .insert({
          user_id: user.id,
          title: songTitle || null,
          prompt: earlyPrompt,
          style: earlyStyle || null,
          status: "draft",
          vocals_only: vocalsOnly,
          beat_path: beatPath || null,
          target_duration_sec: overrideTargetSec,
          extra_context: extraContext.trim() || null,
          is_public: override?.isPublic ?? true,
          foul_mouth: trackFoulMouth,
          foul_intensity: trackFoulIntensity,
          orchestration: { lyrics: lyricBody, suno: sunoBase },
          orchestration_due_at: new Date(Date.now() + 4 * 60_000).toISOString(),
        } as never)
        .select("id")
        .single();
      if (stale()) return;
      if (stageErr || !staged?.id) throw new Error(stageErr?.message || "Couldn't save song");
      const stagedId = (staged as { id: string }).id;
      attemptSongId = stagedId;
      void updateAttempt(attemptId, { song_id: stagedId });
      // Hand the whole job to the server queue. The phone just watches the
      // row; closing the app or losing signal can't stop the song now.
      void runQueuedSong({ data: { songId: stagedId } }).catch(() => {
        /* background worker resumes it from the saved plan */
      });
      setTrackedSongId(stagedId);
      if (override?.titlePromise) {
        void override.titlePromise.then((named) => {
          const t = named.trim();
          if (!t) return;
          setTitle(t);
          const fp =
            [t, songSubject ? `For: ${songSubject}` : null, earlyStyle ? `Style: ${earlyStyle}` : null, songLanguage ? `Language: ${songLanguage}` : null]
              .filter(Boolean)
              .join(" — ") + (songDetails ? `\n— Idea: ${songDetails}` : "");
          void supabase.from("songs").update({ title: t, prompt: fp } as never).eq("id", stagedId).eq("status", "draft");
        });
      }
      const row = { id: stagedId };
      // Stay on the page: a realtime subscription on this row drives the
      // status indicator until the track is ready (or fails).
      void updateAttempt(attemptId, { stage: "queued", status: "succeeded", song_id: row.id });
      library.refetch();
      toast.success("OG Bot is cooking your track — you can close the app, it'll be in your Library");
      try {
        window.localStorage.removeItem(WIZARD_DRAFT_KEY);
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      void updateAttempt(attemptId, {
        status: "failed",
        stage: attemptStage,
        song_id: attemptSongId,
        error_message: msg.slice(0, 1000),
        context: { error: describeError(e), stale: stale(), draft: savedDraft },
      });
      // Leave the job queued on the server: the background worker finishes it
      // from the saved answers within a few minutes, no tap needed.
      if (attemptSongId) {
        void supabase
          .from("songs")
          .update({
            error_message: "Finishing in the background — no need to retype anything.",
            orchestration_due_at: new Date(Date.now() + 60_000).toISOString(),
          } as never)
          .eq("id", attemptSongId)
          .eq("status", "draft");
      }
      if (stale()) return;
      setPipeline((p) => ({ ...p, stage: "error", error: msg }));
      toast.error(msg);
    } finally {
      pipelineLockRef.current = false;
    }
  }

  const pipelineActive = pipeline.stage !== "idle" && pipeline.stage !== "error";
  const currentStage = pipeline.stage as Exclude<PipelineStage, "idle" | "error">;
  const stageElapsed = pipelineActive ? Math.max(0, pipelineNow - pipeline.stageStartedAt) : 0;

  // Adaptive ETA: use real durations from completed stages to scale future estimates.
  const doneList = PIPELINE_ORDER.filter((s) => pipeline.durations[s] != null);
  const calibration = (() => {
    if (doneList.length === 0) return 1;
    let actual = 0,
      base = 0;
    for (const s of doneList) {
      actual += pipeline.durations[s] ?? 0;
      base += BASE_STAGE_ETA[s as keyof typeof BASE_STAGE_ETA];
    }
    if (base <= 0) return 1;
    return Math.max(0.4, Math.min(2.5, actual / base));
  })();

  const currentBaseline = pipelineActive ? BASE_STAGE_ETA[currentStage] * calibration : 0;
  const currentRemaining = Math.max(0, currentBaseline - stageElapsed);
  const currentIdx = PIPELINE_ORDER.indexOf(currentStage);
  const futureRemaining = pipelineActive
    ? PIPELINE_ORDER.slice(currentIdx + 1).reduce(
        (sum, s) => sum + BASE_STAGE_ETA[s as keyof typeof BASE_STAGE_ETA] * calibration,
        0,
      )
    : 0;
  const totalRemaining = currentRemaining + futureRemaining;
  const totalBudget = PIPELINE_ORDER.reduce(
    (sum, s) => sum + BASE_STAGE_ETA[s as keyof typeof BASE_STAGE_ETA] * calibration,
    0,
  );
  const totalElapsed = pipelineActive ? Math.max(0, pipelineNow - pipeline.startedAt) : 0;
  const pipelinePct = pipelineActive
    ? Math.min(97, Math.round((totalElapsed / Math.max(1, totalBudget)) * 100))
    : 0;
  // Past the estimate we stop counting down and say plainly that it's still
  // rendering, rather than sitting on "Almost there…" for minutes.
  const pipelineEtaLabel = (() => {
    if (totalRemaining <= 1000) return "Still rendering — no fixed time";
    const secs = Math.ceil(totalRemaining / 1000);
    return secs >= 60
      ? `~${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s left`
      : `~${secs}s left`;
  })();
  const pipelineStageLabel: Record<PipelineStage, string> = {
    idle: "",
    lyrics: "Writing lyrics around your details",
    saving: "Saving your track",
    submitting: "Sending to the studio",
    rendering: "Rendering your audio — usually 2-5 minutes, sometimes longer",
    error: "Something went wrong",
  };
  const pipelineStageTitle: Record<Exclude<PipelineStage, "idle" | "error">, string> = {
    lyrics: "Writing lyrics",
    saving: "Saving",
    submitting: "Studio",
    rendering: "Rendering audio",
  };

  const library = useQuery({
    queryKey: ["library", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Song[]> => {
      const { data, error } = await supabase
        .from("songs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Song[];
    },
  });

  // After an unlock, start the full (not sample) version of that track.
  useEffect(() => {
    const id = peekFullTrackPlay();
    if (!id || !playlist) return;
    const row = (library.data ?? []).find((s) => s.id === id) as
      | (Song & { unlocked?: boolean | null })
      | undefined;
    if (!row || !row.unlocked) {
      const t = window.setTimeout(() => void library.refetch(), 1500);
      return () => window.clearTimeout(t);
    }
    let tries = 0;
    const iv = window.setInterval(() => {
      tries += 1;
      if (playlist.getControls(id)) {
        clearFullTrackPlay();
        window.clearInterval(iv);
        playlist.playId(id);
      } else if (tries > 40) {
        clearFullTrackPlay();
        window.clearInterval(iv);
      }
    }, 300);
    return () => window.clearInterval(iv);
  }, [library.data, playlist]);

  const versionedLibrary = useMemo(() => {
    // Hidden alt-takes stay out of the library until the user pays to remake.
    const list = (library.data ?? []).filter((s) => {
      const row = s as Song & { is_variation?: boolean | null; revealed?: boolean | null };
      return !row.is_variation || !!row.revealed;
    });
    const sortedAsc = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const totals = new Map<string, number>();
    const running = new Map<string, number>();
    const versionOf = new Map<string, number>();
    for (const s of sortedAsc) {
      const key = (s.title || "Untitled").trim().toLowerCase();
      totals.set(key, (totals.get(key) ?? 0) + 1);
      const next = (running.get(key) ?? 0) + 1;
      running.set(key, next);
      versionOf.set(s.id, next);
    }
    return list.map((s) => {
      const key = (s.title || "Untitled").trim().toLowerCase();
      const total = totals.get(key) ?? 1;
      const v = versionOf.get(s.id) ?? 1;
      const base = s.title || "Untitled";
      const display = total > 1 ? `${base} · Version ${v}` : base;
      return { ...s, title: display };
    });
  }, [library.data]);

  // Active jobs (queued/processing/failed) for the queue panel; completed
  // tracks are rendered as cards below — never both, so nothing shows twice.
  const activeJobs = useMemo(
    () => versionedLibrary.filter((s) => s.status !== "completed"),
    [versionedLibrary],
  );
  const completedTracks = useMemo(
    () => versionedLibrary.filter((s) => s.status === "completed"),
    [versionedLibrary],
  );
  const yoursStyles = useMemo(
    () =>
      POOLS.genre.filter((genre) =>
        completedTracks.some((song) =>
          (song.style || "").toLowerCase().includes(genre.toLowerCase()),
        ),
      ),
    [completedTracks],
  );

  /** Live queue read-out that drives the console meter + status LEDs. */
  const queue = useMemo(() => {
    let queued = 0,
      rendering = 0,
      failed = 0;
    for (const s of activeJobs) {
      if (s.status === "failed") failed++;
      else if (s.status === "processing") rendering++;
      else queued++;
    }
    const inFlight = queued + rendering;
    return {
      queued,
      rendering,
      failed,
      inFlight,
      // 2 concurrent generations = the desk is at capacity.
      load: Math.min(1, (rendering * 1 + queued * 0.5) / 2),
    };
  }, [activeJobs]);

  const COMMUNITY_PAGE_SIZE = 50;
  const community = useInfiniteQuery({
    queryKey: ["library-community", user?.id],
    enabled: !!user,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<Song[]> => {
      const offset = (pageParam as number) * COMMUNITY_PAGE_SIZE;
      // Uses a SECURITY DEFINER RPC that returns only safe public fields
      // (no prompts, lyrics, or generation metadata).
      const { data, error } = await supabase.rpc("list_community_songs", {
        p_offset: offset,
        p_limit: COMMUNITY_PAGE_SIZE,
      });
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const ids = rows.map((s) => String(s.id));
      const unlockedIds = new Set<string>();
      if (ids.length > 0) {
        const { data: unlocks, error: unlockError } = await supabase
          .from("unlocked_songs")
          .select("song_id")
          .in("song_id", ids);
        if (unlockError) throw unlockError;
        for (const unlock of unlocks ?? []) unlockedIds.add(unlock.song_id);
      }
      // Merge the listener's unlock ledger into the safe public track fields.
      // artistUnlocked mirrors the creator's unlock: once the artist unlocks a
      // track, everyone can listen free — only download/share still costs coins.
      return rows.map((s) => ({
        prompt: "",
        ...s,
        artistUnlocked: !!s.unlocked,
        // Your own Community tracks follow your own unlock state.
        unlocked:
          unlockedIds.has(String(s.id)) || (s.user_id === user?.id && !!s.unlocked),
      })) as unknown as Song[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < COMMUNITY_PAGE_SIZE ? undefined : allPages.length,
    // Keep the global feed in sync for every user on web, Android and iOS:
    // other users' songs can't stream via realtime (private rows), so poll
    // and refresh whenever the app/tab comes back into view.
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: "always",
  });
  const communityTracks = useMemo(() => community.data?.pages.flat() ?? [], [community.data]);
  const communityStyles = useMemo(
    () =>
      POOLS.genre.filter((genre) =>
        communityTracks.some((song) =>
          (song.style || "").toLowerCase().includes(genre.toLowerCase()),
        ),
      ),
    [communityTracks],
  );
  const communitySentinelRef = useRef<HTMLDivElement | null>(null);
  useInfiniteScrollSentinel(communitySentinelRef, {
    enabled: !!community.hasNextPage && !community.isFetchingNextPage,
    onHit: () => community.fetchNextPage(),
    deps: [community.hasNextPage, community.isFetchingNextPage, communityTracks.length],
  });

  // The global player is a complete queue, not only the first visible page.
  useEffect(() => {
    if (community.hasNextPage && !community.isFetchingNextPage) {
      void community.fetchNextPage();
    }
  }, [community.hasNextPage, community.isFetchingNextPage, community.data?.pages.length]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("songs-library")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "songs", filter: `user_id=eq.${user.id}` },
        () => library.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ------------------------------------------------------------------
   * Realtime generation status: watch the song we just submitted and flip
   * the indicator the instant the backend marks it completed or failed.
   * Falls back to a slow poll in case a realtime event is missed.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (!trackedSongId) return;
    let cancelled = false;

    const settle = (row: Song) => {
      if (cancelled) return;
      const orch = (row as unknown as { orchestration?: { stage?: string } | null }).orchestration;
      if (row.status === "draft") {
        const ly = (row as unknown as { lyrics?: string | null }).lyrics;
        if (ly) setLyrics(ly);
        const st = orch?.stage;
        if (st === "submitting") advanceStage("submitting");
        return;
      }
      if (row.status === "processing" || row.status === "pending") {
        if (pipelineStageRef.current !== "rendering" && pipelineStageRef.current !== "idle") advanceStage("rendering");
        return;
      }
      if (row.status === "completed") {
        setFreshTrack(row);
        setAutoUnlockPrompt(false);
        setPipeline({ stage: "idle", startedAt: 0, stageStartedAt: 0, durations: {} });
        setTrackedSongId(null);
        library.refetch();
        notifiedReadyRef.current.add(row.id);
        window.setTimeout(
          () => statusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
          200,
        );
        const toastId = `song-listen-${row.id}`;
        toast.success("Your track is still downloading, but you can start listening now.", {
          id: toastId,
          duration: 20000,
          action: {
            label: "Play",
            onClick: () => {
              playlist?.playId(row.id);
              toast.dismiss(toastId);
            },
          },
        });
        window.setTimeout(() => playlist?.playId(row.id), 500);
      } else if (row.status === "failed") {
        setPipeline((p) => ({
          ...p,
          stage: "error",
          error:
            "The studio couldn't finish this track. Your coins for a failed render are refunded automatically.",
        }));
        setTrackedSongId(null);
        library.refetch();
        toast.error("Generation failed — please try again");
      }
    };

    const ch = supabase
      .channel(`song-status-${trackedSongId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "songs", filter: `id=eq.${trackedSongId}` },
        (payload) => settle(payload.new as Song),
      )
      .subscribe();

    const poll = window.setInterval(async () => {
      const { data } = await supabase
        .from("songs")
        .select("*")
        .eq("id", trackedSongId)
        .maybeSingle();
      if (data) settle(data as Song);
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedSongId]);

  // Detect songs that just finished (pending → completed) and surface the
  // "Track completed" toast + the inline finished-track card.
  const previouslyActiveRef = useRef<Set<string>>(new Set());
  const notifiedReadyRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const activeIds = new Set(activeJobs.map((s) => s.id));
    for (const song of completedTracks) {
      if (notifiedReadyRef.current.has(song.id)) continue;
      if (!previouslyActiveRef.current.has(song.id)) continue;
      notifiedReadyRef.current.add(song.id);
      const title = song.title || "Your song";
      setFreshTrack(song);
      setAutoUnlockPrompt(false);
      const toastId = `song-listen-${song.id}`;
      toast.success("Your track is still downloading, but you can start listening now.", {
        id: toastId,
        duration: 20000,
        action: {
          label: "Play",
          onClick: () => {
            playlist?.playId(song.id);
            toast.dismiss(toastId);
          },
        },
      });
      window.setTimeout(() => playlist?.playId(song.id), 500);
    }
    previouslyActiveRef.current = activeIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs, completedTracks]);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("songs").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      toast.success("Track deleted");
      setPendingDelete(null);
      library.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function startFromWizard(v: WizardResult, draft: WizardDraft) {
    setWizardDraft(draft);
    setTitle(v.title);
    setSubjectName(v.subjectName);
    setPersonalDetails(v.description.slice(0, PERSONAL_DETAILS_MAX));
    setStyleText(v.style);
    setSelections({ language: v.language });
    setTargetMinutes(Math.max(MIN_TRACK_MINUTES, v.targetMinutes || MIN_TRACK_MINUTES));
    // Everything now runs in the backend — set expectations with a
    // celebratory "come back in 5" popup instead of a bare toast.
    setCooking({ open: true, title: v.title });
    void createSong(v);
    window.setTimeout(
      () => libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      250,
    );
  }

  // A song designed before sign-up (welcome page wizard) starts cooking once
  // the account and coins are loaded; short on coins → reopen the filled wizard.
  const guestPickupRef = useRef(false);
  useEffect(() => {
    if (guestPickupRef.current || !user || !profile) return;
    let pending: { result: WizardResult; draft: WizardDraft } | null = null;
    try {
      const raw = window.localStorage.getItem(GUEST_PENDING_SONG_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    if (!pending?.result || !pending?.draft) return;
    guestPickupRef.current = true;
    try {
      window.localStorage.removeItem(GUEST_PENDING_SONG_KEY);
    } catch {
      /* ignore */
    }
    const draft = { ...EMPTY_DRAFT, ...pending.draft };
    if (balance >= totalCost) {
      toast.success(`Welcome! Cooking "${pending.result.title}" now 🔥`);
      startFromWizard(pending.result, draft);
    } else {
      setWizardDraft(draft);
      setWizardOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, balance, totalCost]);

  return (
    <div
      data-testid="library-root"
      data-scroll-fade
      className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 rounded-none border-x-0 border-white/[0.06] bg-background/80 px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-2 backdrop-blur-2xl [scroll-padding-block:24px] [touch-action:pan-y] sm:rounded-3xl sm:border sm:px-6 md:pb-20"
    >
      {/* Ambient crimson aura — prestige depth, never competes with content */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 -z-10 h-64 w-64 rounded-full bg-primary/15 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-40 -right-24 -z-10 h-56 w-56 rounded-full bg-primary/10 blur-[100px]"
      />

      {/* Studio console header — desk rail, VU meter, live status LEDs */}
      <header
        data-testid="library-hero"
        className="studio-panel overflow-hidden px-4 pb-4 pt-3 sm:px-5"
      >
        <div aria-hidden className="studio-rail -mx-4 mb-3 h-[3px] opacity-60 sm:-mx-5" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.34em] text-primary/80">
              OG Studio · Live desk
            </p>
            <h1 className="truncate font-display text-2xl font-black leading-[1.1] tracking-[-0.02em] sm:text-4xl">
              Hey <span className="text-gradient-brand">{firstName}</span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StudioMeter
              active={pipelineActive || queue.inFlight > 0}
              load={pipelineActive ? Math.max(0.5, queue.load) : queue.load}
              className="hidden sm:flex"
            />
            <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/25 bg-background/50 px-3.5 py-2 backdrop-blur">
              <Coins className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="text-base font-black tabular-nums sm:text-lg">{balance}</span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground sm:inline">
                coins
              </span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.07] pt-2.5">
          <StudioLed
            label={
              pipeline.stage === "error"
                ? "Fault"
                : pipelineActive
                  ? pipelineStageTitle[currentStage]
                  : queue.inFlight > 0
                    ? "Desk busy"
                    : "Desk ready"
            }
            tone={
              pipeline.stage === "error"
                ? "alert"
                : pipelineActive || queue.inFlight > 0
                  ? "busy"
                  : "ok"
            }
            pulse={pipelineActive || queue.inFlight > 0}
          />
          <StudioLed
            label={`${queue.queued} queued`}
            tone={queue.queued > 0 ? "busy" : "idle"}
            pulse={queue.queued > 0}
          />
          <StudioLed
            label={`${queue.rendering} rendering`}
            tone={queue.rendering > 0 ? "busy" : "idle"}
            pulse={queue.rendering > 0}
          />
          {queue.failed > 0 && <StudioLed label={`${queue.failed} failed`} tone="alert" pulse />}
          <StudioLed
            label={`${completedTracks.length} mastered`}
            tone={completedTracks.length > 0 ? "ok" : "idle"}
          />
          <StudioLed label={`${sampleSeconds}s monitor`} tone="idle" />
        </div>
      </header>

      {/* Create — hidden while a generation runs so the status card is the only focus */}
      {!pipelineActive && (
        <section aria-label="Create a track" className="studio-panel px-4 pb-6 pt-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.28em] text-primary">
              Control room
            </h2>
            <StudioMeter active={false} bars={5} className="h-4" />
          </div>

          {/* Track length now lives in step 1 of the wizard — keep this clean. */}
          <p className="text-center text-[11px] font-semibold text-muted-foreground">
            Free to create · {targetMinutes} min
          </p>

          {/* Hazard robotic CREATE button — a big 3D push-button on a base plate */}
          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="hazard-pedestal">
              <span aria-hidden="true" className="hazard-base" />
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                disabled={pipelineActive}
                aria-label="Create now — start a new track"
                style={{
                  background:
                    "radial-gradient(circle at 50% 28%, oklch(0.74 0.24 28), oklch(0.47 0.21 26) 66%, oklch(0.24 0.12 25))",
                }}
                className="hazard-create group grid h-56 w-56 place-items-center rounded-full border-[6px] border-destructive text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-destructive/50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-64 sm:w-64"
              >
                {/* Rotating hazard stripe ring */}
                <span
                  aria-hidden="true"
                  className="hazard-ring absolute inset-2 rounded-full"
                  style={{
                    background:
                      "repeating-conic-gradient(from 0deg, oklch(0.85 0.19 85 / 0.55) 0deg 18deg, transparent 18deg 36deg)",
                    WebkitMask:
                      "radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))",
                  }}
                />
                {/* Breathing core glow */}
                <span
                  aria-hidden="true"
                  className="hazard-core absolute inset-9 rounded-full bg-white/20 blur-md"
                />
                {/* Falling sparks */}
                {SPARKS.map((s, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="hazard-spark"
                    style={
                      {
                        left: s.left,
                        "--spark-delay": s.delay,
                        "--spark-dur": s.dur,
                        "--spark-drift": s.drift,
                      } as CSSProperties
                    }
                  />
                ))}
                <span className="relative z-10 flex flex-col items-center gap-1.5">
                  <Sparkles className="h-10 w-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:h-11 sm:w-11" />
                  <span className="font-display text-4xl font-black uppercase leading-[1.08] tracking-[0.04em] drop-shadow-[0_3px_5px_rgba(0,0,0,0.9)] sm:text-5xl">
                    Create
                  </span>
                  <span className="font-display text-2xl font-black uppercase leading-none tracking-[0.18em] drop-shadow-[0_3px_5px_rgba(0,0,0,0.9)] sm:text-3xl">
                    Now
                  </span>
                </span>
              </button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Jump to your library"
              onClick={() =>
                libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="h-8 gap-1.5 px-3 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              <Disc3 className="h-4 w-4" />
              Library
            </Button>
          </div>
        </section>
      )}

      {/* Beat library — save instrumentals, remix new vocals over them */}
      {!pipelineActive && (
        <BeatLibrary
          userId={user?.id}
          onRemix={(beat: SavedBeat) => {
            setWizardDraft({
              ...wizardDraft,
              vocalsOnly: true,
              beatPath: beat.path,
              beatName: beat.name,
            });
            setWizardOpen(true);
          }}
        />
      )}

      <CreateNowWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialDraft={wizardDraft}
        submitLabel="Create now"
        onComplete={startFromWizard}
      />

      <CookingDialog
        open={cooking.open}
        onOpenChange={(o) => setCooking((c) => ({ ...c, open: o }))}
        title={cooking.title}
        etaMinutes={5}
        safeToLeave
      />

      {/* Creation happens entirely inside the Create now wizard — no inline form. */}

      {/* Live status bar — one-tap pipeline progress */}
      {(pipelineActive || pipeline.stage === "error") && (
        <section
          ref={statusPanelRef}
          role="status"
          aria-live="polite"
          className="space-y-4 rounded-3xl border border-primary/40 bg-card/70 p-5 shadow-glow backdrop-blur-xl sm:p-7"
        >
          {/* Hero: the current stage is the main event */}
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary shadow-glow">
              {pipeline.stage === "error" ? (
                <X className="h-7 w-7" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {pipeline.stage === "error"
                    ? "Stopped"
                    : `Step ${Math.max(1, currentIdx + 1)} of ${PIPELINE_ORDER.length}`}
                </p>
                <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-black text-primary">
                  {pipeline.stage === "error" ? "Retry" : pipelineEtaLabel}
                </span>
              </div>
              <h3 className="mt-1 text-xl font-black leading-tight sm:text-2xl">
                {pipeline.stage === "error"
                  ? "Generation stopped"
                  : pipelineStageTitle[currentStage]}
              </h3>
              <p className="text-sm text-muted-foreground">
                {pipeline.stage === "error"
                  ? pipeline.error || "Please try again."
                  : pipelineStageLabel[pipeline.stage]}
              </p>
            </div>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300 ease-out",
                pipeline.stage === "error"
                  ? "bg-destructive/80"
                  : "bg-gradient-to-r from-primary via-accent to-primary",
              )}
              style={{ width: `${pipeline.stage === "error" ? 100 : pipelinePct}%` }}
            />
          </div>

          {/* Collapsed past/future — a tight strip of dots + one label per side */}
          {pipeline.stage !== "error" && (
            <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3 w-3 text-primary" />
                {currentIdx === 0 ? "Just started" : `${currentIdx} done`}
              </span>
              <div className="flex items-center gap-1" aria-hidden>
                {PIPELINE_ORDER.map((s, i) => (
                  <span
                    key={s}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i < currentIdx && "w-4 bg-primary/70",
                      i === currentIdx && "w-8 bg-primary animate-pulse",
                      i > currentIdx && "w-2 bg-white/15",
                    )}
                  />
                ))}
              </div>
              <span>
                {currentIdx >= PIPELINE_ORDER.length - 1
                  ? "Wrapping up"
                  : `Next · ${pipelineStageTitle[PIPELINE_ORDER[currentIdx + 1] as keyof typeof pipelineStageTitle]}`}
              </span>
            </div>
          )}

          {pipeline.stage === "error" && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  resetPipeline();
                  void createSong(lastOverrides ?? undefined);
                }}
                size="sm"
                className="gap-2 bg-gradient-brand font-black uppercase tracking-wide text-primary-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </Button>
              <Button
                type="button"
                onClick={() => {
                  resetPipeline();
                  setWizardOpen(true);
                }}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <Sparkles className="h-3.5 w-3.5" /> Edit details
              </Button>
              <Button
                type="button"
                onClick={resetPipeline}
                size="sm"
                variant="ghost"
                className="gap-2"
              >
                <X className="h-3.5 w-3.5" /> Dismiss
              </Button>
            </div>
          )}

          {pipelineActive && (
            <Button
              type="button"
              onClick={cancelGeneration}
              size="sm"
              variant="outline"
              className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <X className="h-3.5 w-3.5" /> Cancel generation
            </Button>
          )}
        </section>
      )}

      {/* Masterpiece player — replaces the wizard popup the moment a track lands */}
      <MasterpieceDialog
        open={masterpieceOpen && !pipelineActive}
        onOpenChange={setMasterpieceOpen}
        song={freshTrack}
        sampleSeconds={sampleSeconds}
        unlockCost={unlockCost}
        balance={profile?.coin_balance ?? 0}
        autoUnlockPrompt={autoUnlockPrompt}
      />

      {/* Finished track — stays on the page after the popup is closed */}
      {freshTrack && !pipelineActive && !masterpieceOpen && (
        <FreshTrackCard
          key={freshTrack.id}
          song={freshTrack}
          sampleSeconds={sampleSeconds}
          unlockCost={unlockCost}
          balance={profile?.coin_balance ?? 0}
          autoUnlockPrompt={autoUnlockPrompt}
          onDismiss={() => {
            setFreshTrack(null);
            setAutoUnlockPrompt(false);
          }}
        />
      )}

      {/* Library — two clearly divided shelves */}
      <section
        ref={libraryRef}
        id="library"
        className="scroll-mt-24 border-t-2 border-white/10 pt-6"
      >
        <div
          data-testid="library-your-header"
          className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
        >
          <div className="min-w-0">
            <h2
              data-testid="library-your-heading"
              className="flex min-w-0 items-center gap-2 font-display text-2xl font-black tracking-tight sm:text-3xl"
            >
              <Disc3 className="h-5 w-5 shrink-0 text-primary" />
              <span className="truncate">Music Library</span>
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Your tapes and community sounds
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={library.isFetching}
              onClick={async () => {
                const before = completedTracks.length;
                const beforeActive = activeJobs.length;
                const res = await library.refetch();
                const list = (res.data ?? []) as Song[];
                const after = list.filter((s) => s.status === "completed").length;
                const afterActive = list.filter((s) => s.status !== "completed").length;
                const newReady = after - before;
                if (newReady > 0) {
                  toast.success(
                    `Library refreshed · ${newReady} new track${newReady === 1 ? "" : "s"} ready`,
                  );
                } else if (afterActive > 0) {
                  toast(`Still generating · ${afterActive} in progress`);
                } else if (beforeActive > 0 && afterActive === 0 && newReady === 0) {
                  toast("Library refreshed · no changes yet");
                } else {
                  toast.success("Library up to date");
                }
              }}
              className="h-9 gap-1.5 rounded-full"
              aria-label="Refresh library"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", library.isFetching && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {activeJobs.length > 0 && (
          <div className="mb-4">
            <JobQueuePanel songs={activeJobs} onRemoved={() => void library.refetch()} />
          </div>
        )}

        <Tabs
          defaultValue="yours"
          className="w-full"
          onValueChange={() =>
            requestAnimationFrame(() =>
              libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            )
          }
        >
          <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1.5 rounded-2xl border border-border/60 bg-surface p-1.5 shadow-card">
            <TabsTrigger
              value="yours"
              className="group flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-transparent bg-white/[0.04] px-1.5 py-3 text-[13px] font-black tracking-tight text-muted-foreground shadow-none transition-all hover:bg-white/[0.08] hover:text-foreground data-[state=active]:border-primary/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-glow"
            >
              <Crown className="h-4 w-4 shrink-0 text-primary group-data-[state=active]:text-primary-foreground" />
              <span>My Songs</span>
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-foreground/90 group-data-[state=active]:bg-black/25 group-data-[state=active]:text-primary-foreground">
                {completedTracks.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="community"
              className="group flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-transparent bg-white/[0.04] px-1.5 py-3 text-[13px] font-black tracking-tight text-muted-foreground shadow-none transition-all hover:bg-white/[0.08] hover:text-foreground data-[state=active]:border-fuchsia-400/50 data-[state=active]:bg-fuchsia-500/90 data-[state=active]:text-white data-[state=active]:shadow-glow"
            >
              <Users className="h-4 w-4 shrink-0 text-fuchsia-300 group-data-[state=active]:text-white" />
              <span>Community</span>
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-foreground/90 group-data-[state=active]:bg-black/25 group-data-[state=active]:text-white">
                {communityTracks.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="yours" className="mt-0 space-y-3">
            <LibraryFilters
              mode={yoursFilter}
              onModeChange={setYoursFilter}
              styles={yoursStyles}
              selectedStyle={yoursStyle}
              onStyleChange={setYoursStyle}
              allCount={completedTracks.length}
              unlockedCount={completedTracks.filter((s) => !!s.unlocked).length}
            />

            {completedTracks.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={yoursSearch}
                  onChange={(e) => setYoursSearch(e.target.value)}
                  placeholder="Search your tracks…"
                  className="h-11 rounded-xl border-white/10 bg-white/[0.04] pl-9 text-sm"
                />
              </div>
            )}
            {library.isLoading ? (
              <ul
                aria-label="Loading your tracks"
                aria-busy="true"
                className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-card"
              >
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-1.5 w-full animate-pulse rounded-full bg-white/[0.05]" />
                    </div>
                    <div className="h-10 w-16 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                  </li>
                ))}
              </ul>
            ) : completedTracks.length > 0 || genSong ? (
              (() => {
                const q = yoursSearch.trim().toLowerCase();
                const filtered = completedTracks.filter((s) => {
                  const matchesSearch =
                    !q ||
                    (s.title || "").toLowerCase().includes(q) ||
                    (s.prompt || "").toLowerCase().includes(q) ||
                    (s.style || "").toLowerCase().includes(q);
                  const matchesMode =
                    yoursFilter === "all" ||
                    (yoursFilter === "unlocked" && !!s.unlocked) ||
                    (yoursFilter === "styles" &&
                      !!yoursStyle &&
                      (s.style || "").toLowerCase().includes(yoursStyle.toLowerCase()));
                  return matchesSearch && matchesMode;
                });
                if (filtered.length === 0 && !genSong) {
                  return (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No tracks match these filters.
                    </p>
                  );
                }
                return (
                  <div data-testid="library-cards" className="space-y-2">
                    {genSong && <SongCardSkeleton label="Generating" />}
                    <PlaylistOrder ids={filtered.map((s) => s.id)} />
                    <MiniPlayer />
                    <ul className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-card">
                      {filtered.map((s) => (
                        <CommunityTrackRow
                          key={s.id}
                          song={s}
                          variant="owned"
                          onRemix={remixFromSong}
                          onDelete={setPendingDelete}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })()
            ) : (
              <div className="rounded-3xl border border-dashed border-primary/30 bg-gradient-to-br from-primary/10 to-card/40 p-8 text-center ring-1 ring-white/5 sm:p-10">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 shadow-[0_12px_30px_-12px_var(--primary)]">
                  {activeJobs.length > 0 ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  ) : (
                    <Crown className="h-6 w-6 text-primary" />
                  )}
                </div>
                <p className="mt-4 font-display text-xl font-black leading-tight sm:text-2xl">
                  {activeJobs.length > 0 ? "Generating your first track…" : "Your vault is empty"}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {activeJobs.length > 0
                    ? "Hang tight — finished songs will land here as soon as they're ready."
                    : "Tap Create now to write your first track — finished songs land here."}
                </p>
                {activeJobs.length === 0 && (
                  <Button
                    type="button"
                    onClick={() => setWizardOpen(true)}
                    disabled={pipelineActive}
                    className="mt-5 h-12 gap-2 rounded-2xl bg-gradient-brand px-6 text-sm font-black uppercase tracking-[0.16em] text-primary-foreground"
                  >
                    <Sparkles className="h-4 w-4" />
                    Create now
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="community" className="mt-0 space-y-3">
            <LibraryFilters
              mode={communityFilter}
              onModeChange={setCommunityFilter}
              styles={communityStyles}
              selectedStyle={communityStyle}
              onStyleChange={setCommunityStyle}
              allCount={communityTracks.length}
              unlockedCount={
                communityTracks.filter((s) => !!s.unlocked || !!s.artistUnlocked).length
              }
              lockedCount={
                communityTracks.filter((s) => !s.unlocked && !s.artistUnlocked).length
              }
              hideAll
            />
            {communityTracks.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={communitySearch}
                  onChange={(e) => setCommunitySearch(e.target.value)}
                  placeholder="Search community tracks…"
                  className="h-11 rounded-xl border-white/10 bg-white/[0.04] pl-9 text-sm"
                />
              </div>
            )}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <span>Made by other creators</span>
              <span aria-hidden className="text-primary/60">
                •
              </span>
              <span>Full-length playback · free</span>
              <span aria-hidden className="text-primary/60">
                •
              </span>
              <span className="text-primary">Download · 3 OG coins or 99p</span>
            </p>

            {community.isLoading ? (
              <ul
                aria-label="Loading community tracks"
                aria-busy="true"
                className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-card"
              >
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-1.5 w-full animate-pulse rounded-full bg-white/[0.05]" />
                    </div>
                    <div className="h-10 w-14 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                  </li>
                ))}
              </ul>
            ) : communityTracks.length > 0 ? (
              (() => {
                const q = communitySearch.trim().toLowerCase();
                const filtered = communityTracks.filter((s) => {
                  const matchesSearch =
                    !q ||
                    (s.title || "").toLowerCase().includes(q) ||
                    (s.prompt || "").toLowerCase().includes(q) ||
                    (s.style || "").toLowerCase().includes(q);
                  const matchesMode =
                    communityFilter === "all" ||
                    (communityFilter === "unlocked" && (!!s.unlocked || !!s.artistUnlocked)) ||
                    (communityFilter === "locked" && !s.unlocked && !s.artistUnlocked) ||
                    (communityFilter === "styles" &&
                      !!communityStyle &&
                      (s.style || "").toLowerCase().includes(communityStyle.toLowerCase()));
                  return matchesSearch && matchesMode;
                });
                if (filtered.length === 0) {
                  return (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No community tracks match these filters.
                    </p>
                  );
                }
                return (
                  <div className="space-y-2">
                    <PlaylistOrder ids={filtered.map((s) => s.id)} />
                    <MiniPlayer />
                    <ul className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-card">
                      {filtered.map((s) => (
                        <CommunityTrackRow
                          key={s.id}
                          song={s}
                          onRemix={remixFromSong}
                          onDelete={isBoss ? setPendingDelete : undefined}
                        />
                      ))}
                    </ul>
                    <div ref={communitySentinelRef} className="h-1" aria-hidden />
                    {community.isFetchingNextPage && (
                      <p className="flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Loading more tracks
                      </p>
                    )}
                    {!community.hasNextPage && (
                      <p className="py-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        You've reached the end
                      </p>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="rounded-3xl border border-dashed border-primary/30 bg-gradient-to-br from-primary/10 to-card/40 p-8 text-center ring-1 ring-white/5 sm:p-10">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-4 font-display text-xl font-black leading-tight sm:text-2xl">
                  Nothing here yet
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Be the first — finished tracks from the community land here and play full length
                  for free.
                </p>
                <Button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  disabled={pipelineActive}
                  className="mt-5 h-12 gap-2 rounded-2xl bg-gradient-brand px-6 text-sm font-black uppercase tracking-[0.16em] text-primary-foreground"
                >
                  <Sparkles className="h-4 w-4" />
                  Create the first track
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      <PoweredByOgBot />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this track?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.title || "Untitled"}" will be removed from the library. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReviewDialog
        open={reviewOpen}
        onOpenChange={(o) => !genSong && setReviewOpen(o)}
        title={title}
        subjectName={subjectName}
        selections={selections}
        styleText={styleText}
        personalDetails={personalDetails}
        extraContext={extraContext}
        foulMouth={foulMouth}
        lyrics={lyrics}
        previewCost={audioCost}
        generating={genSong}
        onConfirm={async () => {
          await generateSong();
        }}
      />
    </div>
  );
}
