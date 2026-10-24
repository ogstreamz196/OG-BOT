import { purchaseOwnerTrack } from "@/lib/track-unlock.functions";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureFullUrlAllowed } from "@/lib/ensure-full-url-allowed";
import { Link } from "@tanstack/react-router";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  ListChecks,
  Eye,
  Play,
  Pause,
  Download,
  Lock,
  Unlock,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { readInvokeError } from "@/lib/invoke-error";
import { deleteQueuedSong } from "@/lib/song-queue-actions";
import { languageFromPrompt } from "@/lib/library-utils";
import { useServerFn } from "@tanstack/react-start";
import { recoverStuckSong } from "@/lib/suno-recover.functions";

import { useSettings } from "@/hooks/use-settings";
import { useProfile } from "@/hooks/use-profile";
import type { Song } from "@/components/SongCard";
import { LyricVideoSection } from "@/components/library/LyricVideoSection";

type JobStatus = "queued" | "generating" | "completed" | "failed";

// Suno generations typically finish within 60-120s. After 3 min we surface
// a "taking longer than usual" hint, after 8 min we treat the job as stuck
// and let the user retry without waiting for the watchdog.
const SLOW_THRESHOLD_MS = 3 * 60 * 1000;
const STUCK_THRESHOLD_MS = 8 * 60 * 1000;

function classify(status: string): JobStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "processing") return "generating";
  return "queued";
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function friendlyError(raw?: string | null): string {
  if (!raw) return "Generation failed — tap retry to try again.";
  const msg = raw.toLowerCase();
  if (msg.includes("insufficient") || msg.includes("balance") || msg.includes("coins"))
    return "Not enough coins — top up and retry.";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("stuck"))
    return "Provider timed out — safe to retry, you weren't charged.";
  if (msg.includes("rate") || msg.includes("429")) return "Rate limited — wait a moment and retry.";
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("econn"))
    return "Network hiccup — retry usually fixes it.";
  if (msg.includes("moderation") || msg.includes("policy") || msg.includes("forbidden"))
    return "Blocked by 0G B0T's content policy — edit the prompt and retry.";
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
}

const META: Record<JobStatus, { label: string; icon: typeof Clock3; cls: string; dot: string }> = {
  queued: {
    label: "Queued",
    icon: Clock3,
    cls: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    dot: "bg-amber-400",
  },
  generating: {
    label: "Generating",
    icon: Loader2,
    cls: "border-primary/40 bg-primary/10 text-primary",
    dot: "bg-primary animate-pulse",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "Failed",
    icon: AlertTriangle,
    cls: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    dot: "bg-rose-500",
  },
};

export function JobQueuePanel({ songs, onRemoved }: { songs: Song[]; onRemoved?: () => void }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailsSong, setDetailsSong] = useState<Song | null>(null);
  const recoverSong = useServerFn(recoverStuckSong);

  // Tick once per second while there are in-flight jobs so the elapsed/stall
  // indicators stay accurate without forcing a parent refetch.
  const hasActive = useMemo(
    () =>
      songs.some((s) => {
        const k = classify(s.status);
        return k === "queued" || k === "generating";
      }),
    [songs],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasActive]);

  // Collapse sibling rows from the same Suno task into a single tile so a
  // generation shows ONE clear loading state, then flips to completed when
  // the final row lands — never as multiple partial rows.
  const dedupedSongs = useMemo(() => {
    const byTask = new Map<string, Song>();
    const standalone: Song[] = [];
    for (const s of songs) {
      const taskId = (s as { suno_task_id?: string | null }).suno_task_id;
      if (!taskId) {
        standalone.push(s);
        continue;
      }
      const prev = byTask.get(taskId);
      if (!prev) {
        byTask.set(taskId, s);
        continue;
      }
      const rank = (st: string) =>
        st === "completed" ? 3 : st === "processing" ? 2 : st === "failed" ? 1 : 0;
      if (rank(s.status) > rank(prev.status)) byTask.set(taskId, s);
    }
    return [...standalone, ...byTask.values()];
  }, [songs]);

  const jobs = useMemo(() => {
    const active = dedupedSongs.filter((s) => classify(s.status) !== "completed");
    const recentCompleted = dedupedSongs
      .filter((s) => classify(s.status) === "completed")
      .slice(0, 4);
    return [...active.slice(0, 8), ...recentCompleted].map((s) => {
      const kind = classify(s.status);
      const startedAt = new Date(s.created_at).getTime();
      const elapsed = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
      const inFlight = kind === "queued" || kind === "generating";
      const slow = inFlight && elapsed > SLOW_THRESHOLD_MS;
      const stuck = inFlight && elapsed > STUCK_THRESHOLD_MS;
      return { song: s, kind, elapsed, inFlight, slow, stuck };
    });
  }, [dedupedSongs, now]);

  const counts = useMemo(() => {
    const c: Record<JobStatus, number> = { queued: 0, generating: 0, completed: 0, failed: 0 };
    for (const s of dedupedSongs) c[classify(s.status)]++;
    return c;
  }, [dedupedSongs]);

  /**
   * Retry = "fix this track".
   *
   * First we ask the music engine what actually happened to the existing job.
   * When it already finished (a take's file was broken on the engine's CDN and
   * jammed the delivery), we rebuild the track from the intact take — instant,
   * free, no regeneration. Only when there's genuinely nothing to recover do we
   * submit a fresh generation.
   */
  async function retry(song: Song) {
    setRetrying(song.id);
    try {
      try {
        const recovery = await recoverSong({ data: { songId: song.id } });
        if (recovery.outcome === "completed") {
          toast.success(recovery.message);
          onRemoved?.();
          return;
        }
        if (recovery.outcome === "pending" || recovery.outcome === "unavailable") {
          toast.info(recovery.message);
          return;
        }
      } catch {
        // Recovery is best-effort — fall through to a fresh generation.
      }

      const { data, error } = await supabase.functions.invoke("suno-generate", {
        body: {
          song_id: song.id,
          prompt: song.prompt ?? song.title ?? "Untitled",
          lyrics: (song as { lyrics?: string }).lyrics ?? "",
          title: song.title ?? null,
          style: (song as { style?: string }).style ?? null,
          language: languageFromPrompt(song.prompt ?? null),
        },
      });
      if (error) throw new Error(await readInvokeError(error, "Retry failed"));
      if (data?.accepted === false) {
        throw new Error(data.error || "Your current generations need to finish first");
      }
      toast.success("Retry queued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  /** Remove a job from the queue — cancels + refunds it first when in flight. */
  async function removeJob(song: Song) {
    if (!window.confirm(`Remove "${song.title || "Untitled"}" from the queue?`)) return;
    setDeleting(song.id);
    try {
      await deleteQueuedSong(song);
      toast.success("Removed from the queue");
      onRemoved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove that track");
    } finally {
      setDeleting(null);
    }
  }

  if (jobs.length === 0) return null;

  return (
    <section className="rounded-3xl border border-white/10 bg-card/40 p-5 ring-1 ring-white/5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary/30 to-fuchsia-500/15">
            <ListChecks className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-lg font-black tracking-tight sm:text-xl">
              Generation queue
            </h3>
            <p className="text-xs text-muted-foreground">Live status — updates instantly</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs font-bold uppercase tracking-wider">
          {(["queued", "generating", "completed", "failed"] as JobStatus[]).map((k) => (
            <span
              key={k}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                META[k].cls,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", META[k].dot)} />
              {counts[k]} {META[k].label}
            </span>
          ))}
        </div>
      </div>

      <ul className="grid gap-2">
        {jobs.map(({ song, kind, elapsed, inFlight, slow, stuck }) => {
          const m = META[kind];
          const Icon = m.icon;
          const showRetry = kind === "failed" || stuck;
          const autoRetrying =
            kind === "failed" && !!song.next_retry_at && song.failure_class !== "terminal";
          const subline = autoRetrying
            ? "Retrying automatically in the background"
            : kind === "failed"
              ? friendlyError(song.error_message)
              : inFlight
                ? `${m.label} · ${formatElapsed(elapsed)}${stuck ? " · looks stuck" : slow ? " · taking longer than usual" : ""}`
                : m.label;
          return (
            <li
              key={song.id}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-2xl border border-white/10 bg-background/40 p-3",
                stuck && "border-rose-500/40 bg-rose-500/5",
                slow && !stuck && "border-amber-400/40 bg-amber-400/5",
              )}
            >
              <span
                className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl border", m.cls)}
              >
                <Icon className={cn("h-4 w-4", kind === "generating" && "animate-spin")} />
              </span>
              <div className="min-w-0 flex-1">
                {/* Every row — including tracks still rendering — opens the
                    workspace so details, style and language can be reviewed. */}
                <Link
                  to="/library/$songId"
                  params={{ songId: song.id }}
                  className="block truncate text-sm font-bold hover:text-primary focus:outline-none focus-visible:underline"
                >
                  {song.title || "Untitled"}
                </Link>

                <p
                  className={cn(
                    "truncate text-xs uppercase tracking-wider",
                    kind === "failed" || stuck
                      ? "text-rose-200"
                      : slow
                        ? "text-amber-200"
                        : "text-muted-foreground",
                  )}
                  title={kind === "failed" ? (song.error_message ?? undefined) : undefined}
                >
                  {subline}
                </p>
              </div>
              {showRetry && !autoRetrying && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => retry(song)}
                  disabled={retrying === song.id || deleting === song.id}
                  aria-label={`Retry ${song.title || "track"}`}
                  title="Retry"
                  className="h-9 w-9 shrink-0 rounded-full"
                >
                  {retrying === song.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              )}
              {kind !== "completed" && (
                <Link
                  to="/library/$songId"
                  params={{ songId: song.id }}
                  aria-label={`Open details for ${song.title || "track"}`}
                  title="Open details"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-background/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Eye className="h-4 w-4" />
                </Link>
              )}
              {kind === "completed" && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => setDetailsSong(song)}
                  aria-label={`View details for ${song.title || "track"}`}
                  title="View details"
                  className="h-9 w-9 shrink-0 rounded-full"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void removeJob(song)}
                disabled={deleting === song.id}
                aria-label={`Delete ${song.title || "track"}`}
                title="Delete"
                className="h-9 w-9 shrink-0 rounded-full border border-white/10 text-muted-foreground hover:border-destructive/50 hover:text-destructive"
              >
                {deleting === song.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </li>
          );
        })}
      </ul>

      <JobDetailsDrawer
        song={detailsSong}
        open={!!detailsSong}
        onOpenChange={(o) => !o && setDetailsSong(null)}
      />
    </section>
  );
}

function JobDetailsDrawer({
  song,
  open,
  onOpenChange,
}: {
  song: Song | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: settings } = useSettings();
  const { data: profile, refetch: refetchProfile } = useProfile();
  const sampleSeconds = settings?.sample_seconds ?? 60;
  const unlockCost =
    (settings as { coins_per_full_unlock?: number } | undefined)?.coins_per_full_unlock ?? 5;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset on open / song change and fetch unlock status + preview URL
  useEffect(() => {
    if (!open || !song) return;
    let cancelled = false;
    setPreviewUrl(null);
    setFullUrl(null);
    setPlaying(false);
    setProgress(0);
    setLoading(true);
    (async () => {
      try {
        const { data: row } = await supabase
          .from("songs")
          .select("unlocked")
          .eq("id", song.id)
          .maybeSingle();
        if (cancelled) return;
        const isUnlocked = !!(row as { unlocked?: boolean } | null)?.unlocked;
        setUnlocked(isUnlocked);

        const { data, error } = await supabase.functions.invoke("song-url", {
          body: { song_id: song.id, mode: "preview" },
        });
        if (error) throw error;
        if (!cancelled) setPreviewUrl(data.url as string);

        if (isUnlocked) {
          const { data: full } = await supabase.functions.invoke("song-url", {
            body: { song_id: song.id, mode: "full" },
          });
          if (!cancelled && full?.url) setFullUrl(full.url as string);
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Couldn't load track");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, song?.id]);

  // Cap preview at sampleSeconds
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.currentTime);
      if (!unlocked && el.currentTime >= sampleSeconds) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [sampleSeconds, unlocked]);

  // Stop playback when drawer closes
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  }, [open]);

  async function togglePlay() {
    if (!previewUrl) return;
    const el = audioRef.current!;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      if (el.src !== previewUrl) el.src = previewUrl;
      await el.play();
      setPlaying(true);
    }
  }

  const buyOwnerTrack = useServerFn(purchaseOwnerTrack);
  async function handleUnlock() {
    if (!song) return;
    setUnlocking(true);
    try {
      const result = await buyOwnerTrack({ data: { songId: song.id } });
      setUnlocked(true);
      toast.success(`Unlocked + Take 2 free · -${result.cost} coins`);
      refetchProfile?.();
      const { data: full } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full" },
      });
      if (full?.url) setFullUrl(full.url as string);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleDownload() {
    if (!song || !unlocked) return;
    const precheck = await ensureFullUrlAllowed(song.id);
    if (!precheck.ok) {
      toast.error(precheck.reason);
      return;
    }
    setDownloading(true);
    try {
      let url = fullUrl;
      if (!url) {
        const { data, error } = await supabase.functions.invoke("song-url", {
          body: {
            song_id: song.id,
            mode: "full",
            purpose: "download",
            filename: `${song.title || "song"}.mp3`,
          },
        });
        if (error) throw new Error(await readInvokeError(error, "Download failed"));
        url = data.url as string;
        setFullUrl(url);
      }
      const fileName = `${song.title || "song"}.mp3`;
      const blob = await downloadFile(url!, fileName);
      await shareTrack({
        title: song.title || "My track",
        blob,
        filename: fileName,
        songId: song.id,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const pct = Math.min(100, (progress / sampleSeconds) * 100);
  const balance = profile?.coin_balance ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="truncate">{song?.title || "Untitled"}</SheetTitle>
          <SheetDescription>{song?.style || song?.prompt || "Track details"}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Cover */}
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary/30 to-fuchsia-500/15">
            {song?.cover_url ? (
              <img
                src={song.cover_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>

          {/* Player */}
          <div className="rounded-2xl border border-white/10 bg-background/40 p-4">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                onClick={togglePlay}
                disabled={!previewUrl || loading}
                className="h-12 w-12 rounded-full"
                aria-label={playing ? "Pause preview" : "Play preview"}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : playing ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {unlocked ? "Full track" : `${sampleSeconds}s preview`}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
            <audio ref={audioRef} preload="metadata" className="hidden" />
          </div>

          {/* Unlock prompt */}
          {!unlocked ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
              <div className="flex items-center gap-2 text-amber-200">
                <Lock className="h-4 w-4" />
                <p className="text-sm font-bold uppercase tracking-wider">Locked</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Spend <span className="font-bold text-foreground">{unlockCost} coins</span> to
                unlock the full track and get the download link.
              </p>
              <Button
                className="mt-3 w-full"
                onClick={handleUnlock}
                disabled={unlocking || balance < unlockCost}
              >
                {unlocking ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unlock className="mr-2 h-4 w-4" />
                )}
                {balance < unlockCost ? "Not enough coins" : `Unlock for ${unlockCost} coins`}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Balance: {balance} coins
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4">
              <div className="flex items-center gap-2 text-emerald-200">
                <Unlock className="h-4 w-4" />
                <p className="text-sm font-bold uppercase tracking-wider">Unlocked</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                The full track is yours. Download the HQ MP3 anytime.
              </p>
              <div className="mt-3 grid gap-2">
                <Button onClick={handleDownload} disabled={downloading || !fullUrl}>
                  {downloading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download HQ MP3
                </Button>
                {fullUrl && (
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-white/5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open full link
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Lyric video pipeline — preview free, full requires unlock */}
          {song && (
            <LyricVideoSection
              songId={song.id}
              songTitle={song.title || ""}
              mp3Unlocked={unlocked}
              onBalanceChange={refetchProfile}
            />
          )}

          {/* Footer link to dedicated page */}
          {song && (
            <Link
              to="/library/$songId"
              params={{ songId: song.id }}
              onClick={() => onOpenChange(false)}
              className="block text-center text-xs font-bold uppercase tracking-wider text-primary hover:underline"
            >
              Open dedicated track page →
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
