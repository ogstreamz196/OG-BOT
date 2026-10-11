import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Music2,
  Play,
  Pause,
  Download,
  Lock,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile } from "@/lib/download-file";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import type { Song } from "@/components/SongCard";
import { SongWorkspace } from "@/components/library/SongWorkspace";
import { PublishToggle } from "@/components/library/PublishToggle";
import { UnlockConfirmDialog } from "@/components/library/UnlockConfirmDialog";
import { useProfile } from "@/hooks/use-profile";
import { ensureFullUrlAllowed } from "@/lib/ensure-full-url-allowed";

export const Route = createFileRoute("/_authenticated/library/$songId")({
  component: SongDetailPage,
});

type FullSong = Song & { unlocked?: boolean | null; is_public?: boolean | null };

function SongDetailPage() {
  const { songId } = Route.useParams();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["song", songId],
    queryFn: async (): Promise<FullSong | null> => {
      const { data, error } = await supabase
        .from("songs")
        .select("*")
        .eq("id", songId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as FullSong | null;
    },
    // While the song is still queued/generating (draft/pending/processing),
    // poll every 3s as a safety net in case realtime drops an UPDATE.
    refetchInterval: (q) => {
      const s = q.state.data as FullSong | null | undefined;
      if (!s) return 3000;
      return s.status === "draft" || s.status === "pending" || s.status === "processing"
        ? 3000
        : false;
    },
    // Hidden tabs stop polling and catch up as soon as they are visible again.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Realtime subscription scoped to this single row.
  useEffect(() => {
    const channel = supabase
      .channel(`song-detail:${songId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "songs", filter: `id=eq.${songId}` },
        () => qc.invalidateQueries({ queryKey: ["song", songId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [songId, qc]);

  return (
    <DashboardShell title="Song workspace">
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/library">
            <ArrowLeft className="h-4 w-4" /> Back to library
          </Link>
        </Button>

        {isLoading ? (
          <SkeletonState message="Loading track…" />
        ) : error || !data ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center text-muted-foreground">
            Track not found.
          </div>
        ) : (
          <>
            <PlayerCard song={data} onRefresh={refetch} />
            <OwnerPublishToggle song={data} onChanged={refetch} />
            <SongWorkspace song={data} onSaved={refetch} onRefresh={refetch} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function OwnerPublishToggle({ song, onChanged }: { song: FullSong; onChanged: () => void }) {
  const { user } = useAuth();
  if (!user || song.user_id !== user.id) return null;
  return <PublishToggle songId={song.id} isPublic={!!song.is_public} onChanged={onChanged} />;
}

function SkeletonState({ message }: { message: string }) {
  return (
    <div className="grid place-items-center gap-3 rounded-2xl border border-border bg-card py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function PlayerCard({ song, onRefresh }: { song: FullSong; onRefresh: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sampleSeconds = settings?.sample_seconds ?? 60;
  const { user } = useAuth();
  const isOwner = !!user && song.user_id === user.id;
  // Community viewers (non-owners) stream the FULL track for free; downloading
  // costs 2 OG coins (1 burnt, 1 royalty to the creator).
  const communityMode = !isOwner;

  const isReady = song.status === "completed" && !!(song.audio_path || (song as any).sample_path);
  const isFailed = song.status === "failed";
  const isPending =
    song.status === "draft" || song.status === "pending" || song.status === "processing";
  const wasPendingRef = useRef(isPending);
  // Boss/admin accounts always hear the full track — no unlock needed.
  const { isBoss } = useRole();
  const unlocked = !!song.unlocked || isBoss;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const { data: profile } = useProfile();
  const balance = profile?.coin_balance ?? 0;
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-load the preview URL as soon as the song becomes ready,
  // and warm the <audio> element so the first play click is instant.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isReady || previewUrl || loadingPreview) return;
      setLoadingPreview(true);
      try {
        const { data, error } = await supabase.functions.invoke("song-url", {
          body:
            communityMode || unlocked
              ? { song_id: song.id, mode: "full", purpose: "stream" }
              : { song_id: song.id, mode: "preview" },
        });

        if (error) throw error;
        if (cancelled) return;
        setPreviewUrl(data.url as string);
        const el = audioRef.current;
        if (el && el.src !== data.url) {
          el.src = data.url as string;
          el.load();
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load preview");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isReady, song.id, previewUrl, loadingPreview, communityMode, unlocked]);

  // The moment a track becomes paid-for, drop the sample link so the player
  // reloads with the full-length version.
  const wasUnlockedRef = useRef(unlocked);
  useEffect(() => {
    if (unlocked && !wasUnlockedRef.current) {
      wasUnlockedRef.current = true;
      setPreviewUrl(null);
      setProgress(0);
      setPlaying(false);
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    }
    wasUnlockedRef.current = unlocked;
  }, [unlocked]);

  // Once the preview URL is warmed after a pending→ready transition, auto-play
  // it so the user gets an immediate "song is ready" moment.
  useEffect(() => {
    if (!isReady || !previewUrl || !wasPendingRef.current) return;
    wasPendingRef.current = false;
    const el = audioRef.current;
    if (!el) return;
    if (el.src !== previewUrl) el.src = previewUrl;
    el.play()
      .then(() => {
        setPlaying(true);
        toast.success("Song is ready — playing preview");
      })
      .catch(() => {
        // Autoplay blocked (no gesture yet) — just surface the ready toast.
        toast.success("Song is ready to play");
      });
  }, [isReady, previewUrl]);

  // Enforce the sample cap only when the track hasn't been paid for. Once it's
  // unlocked (or you're listening to a community track) the whole song plays.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.currentTime);
      if (!communityMode && !unlocked && el.currentTime >= sampleSeconds) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [sampleSeconds, communityMode, unlocked]);

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

  // Community viewers: open a confirmation modal before charging.
  function requestDownload() {
    if (communityMode) {
      setUnlockDialogOpen(true);
      return;
    }
    if (!unlocked) {
      toast.error("This track isn't unlocked. Purchase or unlock to download the full version.");
      return;
    }
    void downloadFull();
  }

  async function downloadFull() {
    setDownloading(true);
    try {
      if (communityMode) {
        const { data: unlockData, error: unlockErr } = await supabase.functions.invoke(
          "unlock-full-song",
          { body: { song_id: song.id } },
        );
        if (unlockErr) {
          const msg =
            (unlockErr as { context?: { error?: string } })?.context?.error ||
            unlockErr.message ||
            "Could not unlock track";
          throw new Error(msg);
        }
        if (!unlockData?.already) {
          toast.success(
            `Charged ${unlockData?.cost ?? 3} OG coins — ${unlockData?.royalty ?? 1} sent to the creator as a royalty.`,
          );
        }
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["profile"] }),
          qc.invalidateQueries({ queryKey: ["song", song.id] }),
        ]);
        onRefresh();
      } else {
        const precheck = await ensureFullUrlAllowed(song.id);
        if (!precheck.ok) {
          toast.error(precheck.reason);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download" },
      });
      if (error) {
        const msg =
          (error as { context?: { error?: string } })?.context?.error ||
          error.message ||
          "Download failed";
        throw new Error(msg);
      }
      const a = document.createElement("a");
      a.href = data.url as string;
      a.download = `${song.title || "song"}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setUnlockDialogOpen(false);
      // Payment done — pull the fresh song + balance so the player instantly
      // switches from the short sample to the full track.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profile"] }),
        qc.invalidateQueries({ queryKey: ["song", song.id] }),
        qc.invalidateQueries({ queryKey: ["songs"] }),
      ]);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const progressDenom =
    communityMode || unlocked
      ? Math.max(1, song.duration_seconds ?? audioRef.current?.duration ?? sampleSeconds)
      : sampleSeconds;

  const progressPct = useMemo(
    () => Math.min(100, (progress / progressDenom) * 100),
    [progress, progressDenom],
  );

  return (
    <article
      id="song-player"
      tabIndex={-1}
      aria-label="Song player"
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-6"
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative h-48 w-48 shrink-0 self-center overflow-hidden rounded-xl bg-gradient-brand-soft">
          {song.cover_url ? (
            <img
              src={song.cover_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <Music2 className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          {isPending && (
            <div className="absolute inset-0 grid place-items-center bg-black/55">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div>
            <h2 className="break-words text-xl font-bold leading-tight sm:text-2xl">
              {song.title || (isPending ? "Generating…" : "Untitled")}
            </h2>
            <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-muted-foreground">
              {song.prompt}
            </p>
            {song.style && (
              <span className="mt-3 inline-block max-w-full break-words rounded-lg bg-secondary px-2.5 py-1 text-xs leading-relaxed text-secondary-foreground">
                {song.style}
              </span>
            )}
          </div>

          <div className="mt-4">
            {isPending && <GeneratingStatus song={song} />}
            {isFailed && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4" />
                {song.error_message || "Generation failed."}
              </div>
            )}
            {isReady && (
              <div className="flex items-center gap-2 text-sm text-primary" aria-live="polite">
                <CheckCircle2 className="h-4 w-4" /> Ready to play
              </div>
            )}
          </div>

          {isReady && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
                <Button
                  onClick={togglePlay}
                  disabled={!previewUrl || loadingPreview}
                  size="lg"
                  className="h-auto min-h-11 min-w-0 whitespace-normal rounded-lg px-3 py-2 text-center leading-tight sm:rounded-full sm:px-8"
                >
                  {loadingPreview ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : playing ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                  {playing
                    ? communityMode
                      ? "Pause"
                      : "Pause preview"
                    : communityMode
                      ? "Play full track"
                      : "Play preview"}
                </Button>
                <Button
                  onClick={requestDownload}
                  disabled={downloading || (!communityMode && !unlocked)}
                  variant={communityMode || unlocked ? "default" : "outline"}
                  size="lg"
                  className="h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 text-center leading-tight sm:px-8"
                >
                  {downloading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : communityMode || unlocked ? (
                    <Download className="h-5 w-5" />
                  ) : (
                    <Lock className="h-5 w-5" />
                  )}
                  {communityMode ? "Download · 3 coins" : unlocked ? "Download HQ" : "Locked"}
                </Button>
              </div>

              <div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  {communityMode
                    ? "Full community track plays free. Downloading costs 3 OG coins — 2 burnt, 1 royalty to the creator."
                    : `Preview limited to ${sampleSeconds}s. ${unlocked ? "Full track download available." : "Unlock to download the full track."}`}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="mt-4">
              <Button variant="outline" onClick={onRefresh} size="sm">
                Refresh
              </Button>
            </div>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        onEnded={() => setPlaying(false)}
        className="hidden"
        data-og-track={song.id}
        data-og-title={song.title || "OG track"}
      />

      <UnlockConfirmDialog
        open={unlockDialogOpen}
        onOpenChange={setUnlockDialogOpen}
        onConfirm={downloadFull}
        busy={downloading}
        cost={3}
        royalty={1}
        balance={balance}
        songTitle={song.title}
      />
    </article>
  );
}

function GeneratingStatus({ song }: { song: FullSong }) {
  const startedAt = useMemo(() => new Date(song.created_at).getTime(), [song.created_at]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const elapsedLabel = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;

  const hasCover = !!song.cover_url;
  const hasAudio = !!(song.audio_path || (song as any).sample_path);
  type StepState = "done" | "active" | "pending";
  const steps: { label: string; hint: string; state: StepState }[] = [
    { label: "Brief queued", hint: "Sent to the studio", state: "done" },
    {
      label: "Writing arrangement",
      hint: "Composing the track structure",
      state: song.status === "processing" || hasCover || hasAudio ? "done" : "active",
    },
    {
      label: "Generating audio",
      hint: "OG Bot is rendering vocals + instruments",
      state: hasAudio ? "done" : song.status === "processing" ? "active" : "pending",
    },
    {
      label: "Mastering & artwork",
      hint: "Cover art + final polish",
      state: hasAudio && hasCover ? "done" : hasAudio ? "active" : "pending",
    },
  ];

  const pct = Math.min(99, Math.round((elapsed / 90) * 90) + (hasAudio ? 5 : 0));
  const longRunning = elapsed > 120;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-fuchsia-500/5 to-background p-4 shadow-glow"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Generating your track…
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">Elapsed {elapsedLabel}</div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-brand transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className={
                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold " +
                (s.state === "done"
                  ? "bg-primary text-primary-foreground"
                  : s.state === "active"
                    ? "bg-primary/20 text-primary ring-2 ring-primary"
                    : "bg-white/10 text-muted-foreground")
              }
            >
              {s.state === "done" ? "✓" : i + 1}
            </span>
            <span className="min-w-0">
              <span
                className={
                  s.state === "pending" ? "text-muted-foreground" : "font-semibold text-foreground"
                }
              >
                {s.label}
              </span>
              {s.state === "active" && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {s.hint}
                </span>
              )}
              {s.state === "pending" && (
                <span className="ml-2 text-xs text-muted-foreground">{s.hint}</span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground">
        This usually takes 60–90 seconds. The page refreshes automatically the moment your song is
        ready — feel free to keep it open or come back later.
      </p>
      {longRunning && (
        <p className="text-xs text-amber-400">
          Taking a little longer than usual — sit tight, OG Bot is still cooking.
        </p>
      )}
    </div>
  );
}
